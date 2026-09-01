import { NextResponse, type NextRequest } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { resolveBrand } from '../../../../app/lib/brand'
import { computeForecast } from '../../../lib/forecast'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'

export const dynamic = 'force-dynamic'

// Issue #111: brand was hardcoded to 'cogmap' regardless of what the caller
// actually requested, so exporting from the Seyu forecast page silently
// downloaded CogMap's data. Also had its own duplicated pipeline aggregation
// (summing estimated_annual_revenue_usd directly, the pre-#79 field
// computeForecast() no longer trusts as authoritative, and a shape that
// never applied to Seyu at all — Seyu's forecast is built from
// pricingByCompany, not estimated_annual_revenue_usd). Now calls the same
// computeForecast() the on-page Forecast/the board API already use, so an
// export can never disagree with what the app itself shows for that brand.
const PIPELINE_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const format = (url.searchParams.get('format') || 'csv').toLowerCase()
    const brand = await resolveBrand(url.searchParams.get('brand'))
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    // Issue #192 — this route had no auth at all.
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError
    const tenantId = (url.searchParams.get('tenantId') || 'default').trim() || 'default'

    const client = await clientPromise
    const db = client.db()
    const { forecast } = await computeForecast(db, brand, tenantId)

    const pipelineByColumn: Record<string, any> = forecast?.pipeline || {}
    const pipeline = PIPELINE_COLUMNS.map((col) => {
      const row = pipelineByColumn[col] || {}
      return {
        column: col,
        leads: row.leads || 0,
        participants: row.participants || 0,
        rawRevenue: row.rawRevenue || 0,
        probability: row.probability ?? 0,
        weightedRevenue: row.weightedRevenue || 0,
      }
    })

    if (format === 'csv') {
      const header = 'column,leads,participants,raw_revenue,probability,weighted_revenue\n'
      const rows = pipeline.map((row) => [row.column, row.leads, row.participants, row.rawRevenue, row.probability, row.weightedRevenue].join(',')).join('\n')
      const body = header + rows
      const csvHeaders = { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${brand}-forecast.csv"` }
      return new NextResponse(body, { status: 200, headers: csvHeaders })
    }

    return NextResponse.json({ brand, pipeline, totals: { weighted: pipeline.reduce((sum, row) => sum + row.weightedRevenue, 0) } })
  } catch (error: any) {
    console.error('[API:forecast/export] GET error:', error)
    return NextResponse.json({ error: 'Failed to export forecast', details: error.message }, { status: 500 })
  }
}
