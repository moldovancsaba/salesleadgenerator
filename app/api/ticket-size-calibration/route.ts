import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { resolveBrand } from '../../lib/brand'
import { getOrRecomputeTicketSizeCalibration } from '../../lib/ticket-size-calibration-store'
import { DEFAULT_MIN_SAMPLE_SIZE } from '../../../lib/ticket-size-calibration'

export const dynamic = 'force-dynamic'

// Lazy recompute, identical shape to GET /api/win-rates (issue #56): returns
// the cached ticket_size_calibration doc, recomputing first only if it's
// missing or more than 24h stale. Read-only — no write-path involvement, so
// this can never affect lead creation/update latency or correctness.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const brand = resolveBrand(url.searchParams.get('brand') || 'cogmap')
    const tenantId = (url.searchParams.get('tenantId') || 'default').trim() || 'default'
    const minSampleSizeParam = Number(url.searchParams.get('minSampleSize'))
    const minSampleSize = Number.isFinite(minSampleSizeParam) && minSampleSizeParam > 0
      ? Math.round(minSampleSizeParam)
      : DEFAULT_MIN_SAMPLE_SIZE

    const client = await clientPromise
    const db = client.db()
    const doc = await getOrRecomputeTicketSizeCalibration(db, brand, tenantId, minSampleSize, new Date())

    return NextResponse.json({
      tenantId,
      brand,
      computedAt: new Date(doc.computedAt).toISOString(),
      minSampleSize: doc.minSampleSize,
      groups: doc.result.groups,
      wonWithoutEstimate: doc.result.wonWithoutEstimate,
      wonWithoutActual: doc.result.wonWithoutActual,
    })
  } catch (error: any) {
    console.error('[API:ticket-size-calibration] GET error:', error)
    return NextResponse.json({ error: 'Failed to compute ticket-size calibration', details: error.message }, { status: 500 })
  }
}
