import type { Db } from 'mongodb'
import { DEFAULT_PIPELINE_WEIGHTS } from './pipeline-weights'

// Pure stage-path reconstruction and calibration math, mirroring
// lib/forecast-concentration.ts's precedent: the math is Mongo-free and
// independently unit-testable; the settings reader lives in the same file.

export type StageKey = 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL'

export const CALIBRATABLE_STAGES: StageKey[] = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL']

export type OutcomeLogEntry = {
  leadId: string
  createdAt: Date | string
  beforeState?: { kanbanColumn?: string } | null
  afterState?: { kanbanColumn?: string } | null
}

export type StageStat = {
  sampleSize: number
  wonCount: number
  lostCount: number
  rate: number
  confidence: 'ok' | 'insufficient'
}

export type WinRateStats = Record<StageKey, StageStat>

export const DEFAULT_MIN_SAMPLE_SIZE = 20

function isStageKey(value: string | undefined | null): value is StageKey {
  return !!value && (CALIBRATABLE_STAGES as string[]).includes(value)
}

// Reconstructs each lead's stage path by replaying its outcomelogs in
// chronological order, then attributes a WON/LOST terminal outcome back to
// every calibratable stage that lead actually passed through. A no-op
// transition (before === after) is skipped; a lead with no WON/LOST terminal
// state is excluded from every denominator (still-open deals aren't a loss).
export function computeWinRatesFromLogs(
  logs: OutcomeLogEntry[],
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  staticDefaults: Record<string, number> = DEFAULT_PIPELINE_WEIGHTS
): WinRateStats {
  const byLead = new Map<string, OutcomeLogEntry[]>()
  for (const log of logs) {
    if (!log || !log.leadId) continue
    if (!byLead.has(log.leadId)) byLead.set(log.leadId, [])
    byLead.get(log.leadId)!.push(log)
  }

  const counts: Record<StageKey, { won: number; lost: number }> = {
    DISCOVERED: { won: 0, lost: 0 },
    QUALIFIED: { won: 0, lost: 0 },
    ENGAGED: { won: 0, lost: 0 },
    PROPOSAL: { won: 0, lost: 0 },
  }

  for (const entries of byLead.values()) {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    const visited = new Set<StageKey>()
    let current: string | undefined
    for (const entry of sorted) {
      const before = entry.beforeState?.kanbanColumn
      const after = entry.afterState?.kanbanColumn
      if (!after || before === after) continue
      if (isStageKey(before)) visited.add(before)
      current = after
    }
    if (current === 'WON' || current === 'LOST') {
      const bucket = current === 'WON' ? 'won' : 'lost'
      for (const stage of visited) counts[stage][bucket] += 1
    }
  }

  const stats = {} as WinRateStats
  for (const stage of CALIBRATABLE_STAGES) {
    const { won, lost } = counts[stage]
    const n = won + lost
    const rate = n > 0 ? won / n : (staticDefaults[stage] ?? 0)
    stats[stage] = {
      sampleSize: n,
      wonCount: won,
      lostCount: lost,
      rate: Math.round(rate * 10000) / 10000,
      confidence: n >= minSampleSize ? 'ok' : 'insufficient',
    }
  }
  return stats
}

export type CalibratedWeightsResult = {
  weightsUsed: Record<string, number>
  sources: Record<string, 'static' | 'calibrated'>
}

// Substitutes a calibrated rate for a static weight only when calibration is
// enabled AND that stage has enough sample size to trust — otherwise the
// static default silently continues to apply, never a stale/unreliable
// calibrated number.
export function mergeCalibratedWeights(
  staticWeights: Record<string, number>,
  cachedStats: WinRateStats | null,
  mode: 'static' | 'calibrated',
  minSampleSize: number
): CalibratedWeightsResult {
  const weightsUsed: Record<string, number> = { ...staticWeights }
  const sources: Record<string, 'static' | 'calibrated'> = {}
  for (const col of Object.keys(staticWeights)) sources[col] = 'static'

  if (mode === 'calibrated' && cachedStats) {
    for (const stage of CALIBRATABLE_STAGES) {
      const stat = cachedStats[stage]
      if (stat && stat.confidence === 'ok' && stat.sampleSize >= minSampleSize) {
        weightsUsed[stage] = stat.rate
        sources[stage] = 'calibrated'
      }
    }
  }

  return { weightsUsed, sources }
}

export type ForecastCalibrationSettings = {
  mode: 'static' | 'calibrated'
  minSampleSize: number
  windowDays: number | null
}

export const DEFAULT_CALIBRATION_SETTINGS: ForecastCalibrationSettings = {
  mode: 'static',
  minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
  windowDays: null,
}

export async function getForecastCalibrationSettings(db: Db): Promise<ForecastCalibrationSettings> {
  try {
    const doc = await db.collection('settings').findOne({ key: 'forecast_calibration' })
    if (!doc) return DEFAULT_CALIBRATION_SETTINGS
    const mode: 'static' | 'calibrated' = doc.mode === 'calibrated' ? 'calibrated' : 'static'
    const minSampleSize = Number(doc.minSampleSize)
    const windowDaysRaw = doc.windowDays === null || doc.windowDays === undefined ? null : Number(doc.windowDays)
    return {
      mode,
      minSampleSize: Number.isFinite(minSampleSize) && minSampleSize > 0
        ? Math.round(minSampleSize)
        : DEFAULT_CALIBRATION_SETTINGS.minSampleSize,
      windowDays: windowDaysRaw !== null && Number.isFinite(windowDaysRaw) && windowDaysRaw > 0
        ? Math.round(windowDaysRaw)
        : null,
    }
  } catch {
    return DEFAULT_CALIBRATION_SETTINGS
  }
}
