import type { Db } from 'mongodb'
import { computeForecast } from './forecast'
import { BRAND_CONFIG } from './brand'

export const FORECAST_SNAPSHOT_COLLECTION = 'forecast_snapshots'

export type SnapshotSource = 'vercel-cron' | 'manual' | 'backfill'

export type SnapshotWriteResult = {
  brand: string
  tenantId: string
  status: 'written' | 'failed'
  totalWeightedRevenue?: number
  error?: string
}

// Lazily ensures the documented indexes exist. createIndex is idempotent —
// a no-op against an already-matching index — so calling this on every
// write is safe and requires no separate migration script. This has not
// been verified against a live Atlas cluster from this sandbox (no
// MONGODB_URI here); it is a real code-level attempt, not a documentation
// claim of an index that already exists (see _archived/PIPELINE_ARCHITECTURE.md's
// Deduplication section for the same distinction on the `fingerprint` index).
let indexesEnsured = false
async function ensureIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return
  try {
    const collection = db.collection(FORECAST_SNAPSHOT_COLLECTION)
    await collection.createIndex({ brand: 1, tenantId: 1, periodKey: 1 }, { unique: true })
    await collection.createIndex({ brand: 1, tenantId: 1, capturedAt: 1 })
    indexesEnsured = true
  } catch (error) {
    console.error('[API:admin/forecast-snapshot] index creation failed', error)
  }
}

// A new tenant added mid-quarter should start its own snapshot series
// automatically — rather than a hardcoded tenant list, this discovers every
// distinct tenantId actually present in a brand's collection (plus
// 'default', matching lib/tenant.ts's treatment of a missing tenantId).
export async function discoverTenantIds(db: Db, brand: 'cogmap' | 'seyu'): Promise<string[]> {
  const config = BRAND_CONFIG[brand]
  const ids = new Set<string>(['default'])
  try {
    const distinctIds = await db.collection(config.dbCollection).distinct('tenantId')
    for (const id of distinctIds) {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  } catch (error) {
    console.error('[API:admin/forecast-snapshot] tenant discovery failed', { brand, error })
  }
  return [...ids]
}

export async function writeForecastSnapshot(
  db: Db,
  brand: 'cogmap' | 'seyu',
  tenantId: string,
  periodKey: string,
  source: SnapshotSource
): Promise<SnapshotWriteResult> {
  await ensureIndexes(db)

  try {
    const { totalLeads, columnCounts, forecast, weightsUsed } = await computeForecast(db, brand, tenantId)
    const capturedAt = new Date()

    await db.collection(FORECAST_SNAPSHOT_COLLECTION).updateOne(
      { brand, tenantId, periodKey },
      {
        $set: { capturedAt, totalLeads, columnCounts, weightsUsed, forecast, source, createdAt: capturedAt },
        $setOnInsert: { brand, tenantId, periodKey },
      },
      { upsert: true }
    )

    return {
      brand,
      tenantId,
      status: 'written',
      totalWeightedRevenue: forecast?.totalWeightedRevenue ?? 0,
    }
  } catch (error: any) {
    console.error('[API:admin/forecast-snapshot] write error', { brand, tenantId, periodKey, error: error?.message })
    return { brand, tenantId, status: 'failed', error: error?.message || 'Unknown snapshot write failure' }
  }
}
