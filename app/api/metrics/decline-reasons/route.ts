import { NextResponse, type NextRequest } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { getTenantId, tenantFilter } from '@/lib/tenant'
import { buildDeclineMatchStage, shapeGroupedRows, shapeTotalsByReason } from '@/app/lib/decline-reason-rollup'
import type { GroupedAggRow, TotalsAggRow } from '@/app/lib/decline-reason-rollup'
import { requireBrandAccessApi } from '@/lib/require-brand-access-api'

export const dynamic = 'force-dynamic'

const GROUP_BY_FIELDS = ['industry', 'sport_or_sector', 'region'] as const
type GroupByField = typeof GROUP_BY_FIELDS[number]
type GroupBy = 'none' | GroupByField

function parseGroupBy(raw: string | null): GroupBy {
  if (raw && (GROUP_BY_FIELDS as readonly string[]).includes(raw)) return raw as GroupByField
  return 'none'
}

function parseDateParam(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brand = resolveBrand(searchParams.get('brand') || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    // Issue #192 — this route had no auth at all.
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError
    const config = BRAND_CONFIG[brand]
    const tenantId = getTenantId(request)
    const groupBy = parseGroupBy(searchParams.get('groupBy'))
    const from = parseDateParam(searchParams.get('from'))
    const to = parseDateParam(searchParams.get('to'))

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)

    const matchStage = buildDeclineMatchStage(tenantFilter(tenantId), from, to)

    const [totalDeclines, totalsAgg] = await Promise.all([
      collection.countDocuments(matchStage),
      collection.aggregate<TotalsAggRow>([
        { $match: matchStage },
        { $group: { _id: '$declineReason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
    ])

    const totalsByReason = shapeTotalsByReason(totalsAgg)

    let rows: ReturnType<typeof shapeGroupedRows>['rows'] | undefined
    let missingDimensionCount = 0

    if (groupBy !== 'none') {
      const groupedAgg = await collection.aggregate<GroupedAggRow>([
        { $match: matchStage },
        {
          $group: {
            _id: { reason: '$declineReason', dim: { $ifNull: [`$${groupBy}`, null] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]).toArray()

      const shaped = shapeGroupedRows(groupedAgg)
      rows = shaped.rows
      missingDimensionCount = shaped.missingDimensionCount
    }

    return NextResponse.json({
      brand,
      tenantId,
      groupBy,
      period: { from: from?.toISOString(), to: to?.toISOString() },
      fetchedAt: new Date().toISOString(),
      source: 'mongodb',
      totalDeclines,
      ...(rows !== undefined ? { rows } : {}),
      totalsByReason,
      missingDimensionCount,
    })
  } catch (error: any) {
    console.error('[API:metrics/decline-reasons] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch decline reason metrics', details: error.message }, { status: 500 })
  }
}
