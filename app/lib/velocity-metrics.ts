// Pure pipeline-velocity computation over already-fetched outcomelogs rows.
// No Mongo, no React, no internal Date.now() — the caller passes `now`
// explicitly (mirrors lib/stale-deal.ts's shape). A stage transition is any
// log row where beforeState.kanbanColumn !== afterState.kanbanColumn,
// regardless of `action` — COLUMN_MOVE, PIN (forces ENGAGED), and DECLINE
// (forces LOST) all produce one; a naive `action === 'COLUMN_MOVE'` filter
// would silently miss the latter two (issue #58).

const DAY_MS = 86_400_000

export type OutcomeLogRow = {
  leadId: string
  createdAt: Date | string
  beforeState?: { kanbanColumn?: string | null } | null
  afterState?: { kanbanColumn?: string | null } | null
}

export type VelocityTransitionStat = {
  from: string
  to: string
  avgDays: number | null
  medianDays: number | null
  sampleSize: number
  priorPeriodAvgDays: number | null
  trendPct: number | null
}

export type VelocityMetrics = {
  transitions: VelocityTransitionStat[]
  avgTimeInStage: Record<string, number | null>
  periodDays: number
  insufficientData: boolean
}

type Transition = { leadId: string; from: string; to: string; atMs: number }

const MIN_SAMPLE_FLOOR = 5

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function computeTrendPct(avgDays: number | null, priorAvgDays: number | null): number | null {
  if (avgDays === null || priorAvgDays === null || priorAvgDays === 0) return null
  return ((avgDays - priorAvgDays) / priorAvgDays) * 100
}

function extractTransitions(logs: OutcomeLogRow[]): Transition[] {
  const byLead = new Map<string, OutcomeLogRow[]>()
  for (const log of logs) {
    const list = byLead.get(log.leadId)
    if (list) list.push(log)
    else byLead.set(log.leadId, [log])
  }

  const transitions: Transition[] = []
  for (const [leadId, leadLogs] of byLead) {
    const sorted = [...leadLogs].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
    for (const log of sorted) {
      const from = log.beforeState?.kanbanColumn
      const to = log.afterState?.kanbanColumn
      if (from && to && from !== to) {
        transitions.push({ leadId, from, to, atMs: toMs(log.createdAt) })
      }
    }
  }
  return transitions
}

// Duration since the lead arrived at `transition.from`: the time of its
// immediately-preceding transition (whatever it ended at), or — only when
// `from === 'DISCOVERED'` and this is the lead's first recorded transition —
// the lead's own `createdAt` (every lead starts in DISCOVERED). Any other
// "no prior transition" case (sparse pre-feature logs starting mid-pipeline)
// has no known origin time and is excluded, not guessed.
function durationsSincePriorStage(
  leadTransitionsByLead: Map<string, Transition[]>,
  leadCreatedAtMs: Map<string, number>,
  transitions: Transition[]
): Map<Transition, number | null> {
  const result = new Map<Transition, number | null>()
  for (const t of transitions) {
    const leadTransitions = leadTransitionsByLead.get(t.leadId) || []
    const idx = leadTransitions.indexOf(t)
    const prior = idx > 0 ? leadTransitions[idx - 1] : null

    let originMs: number | null = null
    if (prior) {
      originMs = prior.atMs
    } else if (t.from === 'DISCOVERED' && leadCreatedAtMs.has(t.leadId)) {
      originMs = leadCreatedAtMs.get(t.leadId)!
    }

    if (originMs === null || !Number.isFinite(originMs) || t.atMs < originMs) {
      result.set(t, null)
    } else {
      result.set(t, (t.atMs - originMs) / DAY_MS)
    }
  }
  return result
}

export function computeVelocity(
  logs: OutcomeLogRow[],
  leadCreatedAt: Record<string, Date | string>,
  now: Date,
  periodDays = 30
): VelocityMetrics {
  const nowMs = now.getTime()
  const cutoffMs = nowMs - periodDays * DAY_MS
  const priorCutoffMs = cutoffMs - periodDays * DAY_MS

  const leadCreatedAtMs = new Map<string, number>()
  for (const [leadId, createdAt] of Object.entries(leadCreatedAt)) {
    leadCreatedAtMs.set(leadId, toMs(createdAt))
  }

  const transitions = extractTransitions(logs)
  const byLead = new Map<string, Transition[]>()
  for (const t of transitions) {
    const list = byLead.get(t.leadId)
    if (list) list.push(t)
    else byLead.set(t.leadId, [t])
  }

  const durationByTransition = durationsSincePriorStage(byLead, leadCreatedAtMs, transitions)

  const pairs = new Map<string, Transition[]>()
  for (const t of transitions) {
    const key = `${t.from}->${t.to}`
    const list = pairs.get(key)
    if (list) list.push(t)
    else pairs.set(key, [t])
  }

  const transitionStats: VelocityTransitionStat[] = []
  const timeInStageDurations: Record<string, number[]> = {}
  let totalCurrentSamples = 0

  for (const [, pairTransitions] of pairs) {
    const [{ from, to }] = pairTransitions
    const current = pairTransitions.filter((t) => t.atMs >= cutoffMs)
    const prior = pairTransitions.filter((t) => t.atMs >= priorCutoffMs && t.atMs < cutoffMs)

    const currentDurations = current
      .map((t) => durationByTransition.get(t) ?? null)
      .filter((d): d is number => d !== null)
    const priorDurations = prior
      .map((t) => durationByTransition.get(t) ?? null)
      .filter((d): d is number => d !== null)

    for (const d of currentDurations) {
      (timeInStageDurations[from] ??= []).push(d)
    }

    const avgDays = mean(currentDurations)
    const priorPeriodAvgDays = mean(priorDurations)

    transitionStats.push({
      from,
      to,
      avgDays,
      medianDays: median(currentDurations),
      sampleSize: currentDurations.length,
      priorPeriodAvgDays,
      trendPct: computeTrendPct(avgDays, priorPeriodAvgDays),
    })

    totalCurrentSamples += currentDurations.length
  }

  transitionStats.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))

  const avgTimeInStage: Record<string, number | null> = {}
  for (const [stage, durations] of Object.entries(timeInStageDurations)) {
    avgTimeInStage[stage] = mean(durations)
  }

  return {
    transitions: transitionStats,
    avgTimeInStage,
    periodDays,
    insufficientData: totalCurrentSamples < MIN_SAMPLE_FLOOR,
  }
}
