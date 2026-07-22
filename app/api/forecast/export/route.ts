import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { BRAND_CONFIG } from '../../../../app/lib/brand'
import { getPipelineWeights } from '../../../../lib/pipeline-weights'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const format = (url.searchParams.get('format') || 'csv').toLowerCase()
    const brandKey = 'cogmap'
    const config = BRAND_CONFIG[brandKey]

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)

    const pipelineForecast = await collection.aggregate([
      {
        $group: {
          _id: '$kanbanColumn',
          leads: { $sum: 1 },
          participants: { $sum: { $ifNull: ['$estimated_participants', 0] } },
          revenue: { $sum: { $ifNull: ['$estimated_annual_revenue_usd', 0] } },
        },
      },
    ]).toArray()

    const weights = await getPipelineWeights(db)
    const pipelineColumns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']
    const rawByColumn: Record<string, any> = {}
    for (const item of pipelineForecast) rawByColumn[(item._id || 'UNKNOWN') as string] = item
    const pipeline = pipelineColumns.map((col) => ({
      column: col,
      leads: rawByColumn[col]?.leads || 0,
      participants: rawByColumn[col]?.participants || 0,
      rawRevenue: rawByColumn[col]?.revenue || 0,
      probability: weights[col] ?? 0,
      weightedRevenue: Math.round((rawByColumn[col]?.revenue || 0) * (weights[col] ?? 0)),
    }))

    if (format === 'csv') {
      const header = 'column,leads,participants,raw_revenue,probability,weighted_revenue\n'
      const rows = pipeline.map((row) => [row.column, row.leads, row.participants, row.rawRevenue, row.probability, row.weightedRevenue].join(',')).join('\n')
      const body = header + rows
      const csvHeaders = { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="cogmap-forecast.csv"' }
      return new NextResponse(body, { status: 200, headers: csvHeaders })
    }

    return NextResponse.json({ pipeline, totals: { weighted: pipeline.reduce((sum, row) => sum + row.weightedRevenue, 0) } })
  } catch (error: any) {
    console.error('[API:forecast/export] GET error:', error)
    return NextResponse.json({ error: 'Failed to export forecast', details: error.message }, { status: 500 })
  }
}
