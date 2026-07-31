import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { resolveBrand } from '../../lib/brand'
import { getForecastCalibrationSettings } from '../../../lib/win-rate-calibration'
import { getOrRecomputeWinRates } from '../../lib/win-rate-store'

export const dynamic = 'force-dynamic'

// Lazy recompute: returns the cached winrate_calibration doc for this
// (brand, tenantId) pair, recomputing first only if it's missing or more
// than 24h stale (lib/win-rate-store.ts's isStale). This is the only place
// (besides the manual POST /recalculate) a recompute aggregation ever runs —
// GET /api/boards/[brand] only ever reads the cache (issue #56).
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const brand = resolveBrand(url.searchParams.get('brand') || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = (url.searchParams.get('tenantId') || 'default').trim() || 'default'

    const client = await clientPromise
    const db = client.db()
    const calibrationSettings = await getForecastCalibrationSettings(db)
    const doc = await getOrRecomputeWinRates(
      db,
      brand,
      tenantId,
      calibrationSettings.minSampleSize,
      calibrationSettings.windowDays,
      new Date()
    )

    return NextResponse.json({
      tenantId,
      brand,
      computedAt: new Date(doc.computedAt).toISOString(),
      windowDays: doc.windowDays,
      minSampleSize: doc.minSampleSize,
      stages: doc.stages,
    })
  } catch (error: any) {
    console.error('[API:win-rates] GET error:', error)
    return NextResponse.json({ error: 'Failed to compute win rates', details: error.message }, { status: 500 })
  }
}
