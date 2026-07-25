import type { Db } from 'mongodb'
import { tenantFilter } from '../../lib/tenant'
import { computeTicketSizeCalibration, DEFAULT_MIN_SAMPLE_SIZE } from '../../lib/ticket-size-calibration'
import type { WonLeadForCalibration, TicketSizeCalibrationResult } from '../../lib/ticket-size-calibration'
import { BRAND_CONFIG } from './brand'

export const TICKET_SIZE_CALIBRATION_COLLECTION = 'ticket_size_calibration'

export type TicketSizeCalibrationDoc = {
  tenantId: string
  brand: string
  result: TicketSizeCalibrationResult
  computedAt: Date
  minSampleSize: number
}

// Mirrors app/lib/win-rate-store.ts's fetchOutcomeLogs() shape — same
// tenantFilter() precedent, projected to only the three fields this
// computation actually needs.
export async function fetchWonLeadsForCalibration(
  db: Db,
  brand: string,
  tenantId: string
): Promise<WonLeadForCalibration[]> {
  const config = BRAND_CONFIG[brand]
  if (!config) return []

  const filter: Record<string, any> = { ...tenantFilter(tenantId), kanbanColumn: 'WON' }
  const docs = await db
    .collection(config.dbCollection)
    .find(filter)
    .project({ size: 1, ticketSizeEstimate: 1, actualDealValueUsd: 1 })
    .toArray()

  return docs.map((d: any) => ({
    size: d.size,
    ticketSizeEstimate: d.ticketSizeEstimate,
    actualDealValueUsd: d.actualDealValueUsd,
  }))
}

export async function computeAndPersistTicketSizeCalibration(
  db: Db,
  brand: string,
  tenantId: string,
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE
): Promise<TicketSizeCalibrationDoc> {
  const leads = await fetchWonLeadsForCalibration(db, brand, tenantId)
  const result = computeTicketSizeCalibration(leads, minSampleSize)
  const computedAt = new Date()

  await db.collection(TICKET_SIZE_CALIBRATION_COLLECTION).updateOne(
    { tenantId, brand },
    { $set: { result, computedAt, minSampleSize }, $setOnInsert: { tenantId, brand } },
    { upsert: true }
  )

  return { tenantId, brand, result, computedAt, minSampleSize }
}

export async function getCachedTicketSizeCalibration(
  db: Db,
  brand: string,
  tenantId: string
): Promise<TicketSizeCalibrationDoc | null> {
  try {
    const doc = await db.collection(TICKET_SIZE_CALIBRATION_COLLECTION).findOne({ tenantId, brand })
    if (!doc) return null
    return {
      tenantId: doc.tenantId,
      brand: doc.brand,
      result: doc.result,
      computedAt: doc.computedAt,
      minSampleSize: doc.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
    }
  } catch (error) {
    console.error('[app/lib/ticket-size-calibration-store] cached lookup failed', { brand, tenantId, error })
    return null
  }
}

const STALENESS_MS = 24 * 60 * 60 * 1000

// Pure so the 24h staleness boundary is independently unit-testable without
// a live clock or a database — identical contract to
// app/lib/win-rate-store.ts's own isStale().
export function isStale(doc: TicketSizeCalibrationDoc | null, now: Date): boolean {
  if (!doc) return true
  return now.getTime() - new Date(doc.computedAt).getTime() > STALENESS_MS
}

export async function getOrRecomputeTicketSizeCalibration(
  db: Db,
  brand: string,
  tenantId: string,
  minSampleSize: number,
  now: Date
): Promise<TicketSizeCalibrationDoc> {
  const cached = await getCachedTicketSizeCalibration(db, brand, tenantId)
  if (!isStale(cached, now)) return cached as TicketSizeCalibrationDoc
  return computeAndPersistTicketSizeCalibration(db, brand, tenantId, minSampleSize)
}
