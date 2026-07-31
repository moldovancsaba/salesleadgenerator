import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { getTenantId } from '@/lib/tenant'
import { computeForecast } from '@/app/lib/forecast'

export async function GET(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params
    const brand = resolveBrand(brandParam)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const config = BRAND_CONFIG[brand]
    const tenantId = getTenantId(request)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    // weightsUsed is deliberately dropped here — it exists on the shared
    // computeForecast() result for the forecast-snapshot endpoint (issue
    // #57) to persist, but was never part of this route's own response
    // shape and stays that way (no behavior change on extraction).
    const { weightsUsed: _weightsUsed, ...result } = await computeForecast(db, brand, tenantId)

    return NextResponse.json({
      brand,
      label: config.label,
      ...result,
      tenantId,
      source: 'mongodb',
    })
  } catch (error: any) {
    console.error('[API:boards/[brand]] GET error:', error)
    return NextResponse.json({
      error: 'Failed to fetch board metadata',
      details: error.message,
    }, { status: 500 })
  }
}
