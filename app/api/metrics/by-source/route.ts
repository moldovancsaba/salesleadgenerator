import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { getTenantId, tenantFilter } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Issue #123 — which acquisition channel actually produces wins, reusing
// the groupBy-aggregation shape app/api/metrics/decline-reasons/route.ts
// already established for a different dimension (declineReason). Leads
// created before this field existed have no `source` — bucketed under the
// literal "unknown" key here rather than dropped from the aggregate, same
// "never silently exclude" convention as this codebase's other rollups.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const brand = resolveBrand(searchParams.get('brand') || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const config = BRAND_CONFIG[brand]
    const tenantId = getTenantId(request)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)

    const matchStage = tenantFilter(tenantId)

    const agg = await collection.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $ifNull: ['$source', 'unknown'] },
          leads: { $sum: 1 },
          won: { $sum: { $cond: [{ $eq: ['$kanbanColumn', 'WON'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$kanbanColumn', 'LOST'] }, 1, 0] } },
        },
      },
      { $sort: { leads: -1 } },
    ]).toArray()

    const rows = agg.map((row: any) => {
      const closed = row.won + row.lost
      return {
        source: row._id || 'unknown',
        leads: row.leads,
        won: row.won,
        lost: row.lost,
        // null (not 0) when nothing has closed yet — an honest "no data,"
        // matching this codebase's "never fabricate a rate from zero
        // samples" convention (e.g. lib/win-rate-calibration.ts's own
        // minSampleSize gate).
        winRate: closed > 0 ? row.won / closed : null,
      }
    })

    return NextResponse.json({
      brand,
      tenantId,
      fetchedAt: new Date().toISOString(),
      rows,
    })
  } catch (error: any) {
    console.error('[API:metrics/by-source] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch source metrics', details: error.message }, { status: 500 })
  }
}
