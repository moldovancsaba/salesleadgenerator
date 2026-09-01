import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { resolveBrand } from '../../../lib/brand'
import { getForecastCalibrationSettings } from '../../../../lib/win-rate-calibration'
import { computeAndPersistWinRates } from '../../../lib/win-rate-store'

export const dynamic = 'force-dynamic'

// Manual/forced recompute — key-guarded (x-api-key), same pattern as
// app/api/admin/forecast-snapshot's POST. Unlike GET /api/win-rates, this
// always recomputes regardless of cache staleness.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const brand = await resolveBrand(typeof body.brand === 'string' ? body.brand : 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = (typeof body.tenantId === 'string' ? body.tenantId.trim() : '') || 'default'

    const client = await clientPromise
    const db = client.db()
    const calibrationSettings = await getForecastCalibrationSettings(db)
    const doc = await computeAndPersistWinRates(
      db,
      brand,
      tenantId,
      calibrationSettings.minSampleSize,
      calibrationSettings.windowDays
    )

    return NextResponse.json({
      tenantId,
      brand,
      computedAt: doc.computedAt.toISOString(),
      windowDays: doc.windowDays,
      minSampleSize: doc.minSampleSize,
      stages: doc.stages,
    })
  } catch (error: any) {
    console.error('[API:win-rates/recalculate] POST error:', error)
    return NextResponse.json({ error: 'Failed to recalculate win rates', details: error.message }, { status: 500 })
  }
}
