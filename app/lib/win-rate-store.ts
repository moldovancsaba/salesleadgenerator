import type { Db } from 'mongodb'
import type { Brand } from './brand'
import { tenantFilter } from '../../lib/tenant'
import {
  computeWinRatesFromLogs,
  DEFAULT_MIN_SAMPLE_SIZE,
} from '../../lib/win-rate-calibration'
import type { OutcomeLogEntry, WinRateStats } from '../../lib/win-rate-calibration'
import { DEFAULT_PIPELINE_WEIGHTS } from '../../lib/pipeline-weights'

export const WIN_RATE_COLLECTION = 'winrate_calibration'

export type WinRateDoc = {
  tenantId: string
  brand: Brand
  stages: WinRateStats
  computedAt: Date
  windowDays: number | null
  minSampleSize: number
}

// Strict tenantId match (not lib/tenant.ts's $or-default fallback) would
// under-count legacy default-tenant docs, so this reuses the same
// tenantFilter() every other tenant-scoped query in this repo already uses.
export async function fetchOutcomeLogs(
  db: Db,
  tenantId: string,
  windowDays: number | null
): Promise<OutcomeLogEntry[]> {
  const filter: Record<string, any> = { ...tenantFilter(tenantId) }
  if (windowDays && windowDays > 0) {
    filter.createdAt = { $gte: new Date(Date.now() - windowDays * 86_400_000) }
  }
  const docs = await db
    .collection('outcomelogs')
    .find(filter)
    .project({ leadId: 1, createdAt: 1, beforeState: 1, afterState: 1 })
    .toArray()

  return docs.map((d: any) => ({
    leadId: String(d.leadId),
    createdAt: d.createdAt,
    beforeState: d.beforeState,
    afterState: d.afterState,
  }))
}

export async function computeAndPersistWinRates(
  db: Db,
  brand: Brand,
  tenantId: string,
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE,
  windowDays: number | null = null
): Promise<WinRateDoc> {
  const logs = await fetchOutcomeLogs(db, tenantId, windowDays)
  const stages = computeWinRatesFromLogs(logs, minSampleSize, DEFAULT_PIPELINE_WEIGHTS)
  const computedAt = new Date()

  await db.collection(WIN_RATE_COLLECTION).updateOne(
    { tenantId, brand },
    { $set: { stages, computedAt, windowDays, minSampleSize }, $setOnInsert: { tenantId, brand } },
    { upsert: true }
  )

  return { tenantId, brand, stages, computedAt, windowDays, minSampleSize }
}

export async function getCachedWinRates(
  db: Db,
  brand: Brand,
  tenantId: string
): Promise<WinRateDoc | null> {
  try {
    const doc = await db.collection(WIN_RATE_COLLECTION).findOne({ tenantId, brand })
    if (!doc) return null
    return {
      tenantId: doc.tenantId,
      brand: doc.brand,
      stages: doc.stages,
      computedAt: doc.computedAt,
      windowDays: doc.windowDays ?? null,
      minSampleSize: doc.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
    }
  } catch (error) {
    console.error('[app/lib/win-rate-store] cached win-rate lookup failed', { brand, tenantId, error })
    return null
  }
}

const STALENESS_MS = 24 * 60 * 60 * 1000

// Pure so the 24h staleness boundary is independently unit-testable without
// a live clock or a database.
export function isStale(doc: WinRateDoc | null, now: Date): boolean {
  if (!doc) return true
  return now.getTime() - new Date(doc.computedAt).getTime() > STALENESS_MS
}

// GET /api/win-rates's lazy-recompute path: never adds aggregation latency
// to the hot board-forecast request (app/lib/forecast.ts only ever reads the
// cached doc via getCachedWinRates) — recompute only happens here, on this
// dedicated endpoint, and only when the cache is missing or >24h stale.
export async function getOrRecomputeWinRates(
  db: Db,
  brand: Brand,
  tenantId: string,
  minSampleSize: number,
  windowDays: number | null,
  now: Date
): Promise<WinRateDoc> {
  const cached = await getCachedWinRates(db, brand, tenantId)
  if (!isStale(cached, now)) return cached as WinRateDoc
  return computeAndPersistWinRates(db, brand, tenantId, minSampleSize, windowDays)
}
