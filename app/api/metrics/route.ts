import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'

const COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'] as const
const REGIONS = ['US', 'CEE', 'MENA'] as const

function getTenantId(request: Request): string {
  return (new URL(request.url).searchParams.get('tenantId') || 'default').trim() || 'default'
}

function tenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId }
}

export async function GET(request: Request) {
  try {
    const brand = resolveBrand(new URL(request.url).searchParams.get('brand') || 'cogmap')
    const config = BRAND_CONFIG[brand]
    const tenantId = getTenantId(request)
    const filter = tenantFilter(tenantId)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)

    const [
      totalCount,
      columnCountsAgg,
      regionCountsAgg,
      iceScoresAgg,
      declineReasonsAgg,
      qualityCountsAgg,
      feedbackAgg,
    ] = await Promise.all([
      collection.countDocuments(filter),
      collection.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$kanbanColumn', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$region', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate<{ score: number }>([
        { $match: filter },
        { $project: { score: { $multiply: ['$ice.impact', '$ice.confidence', '$ice.ease'] } } },
        { $match: { score: { $gt: 0 } } },
      ]).toArray(),
      collection.aggregate<{ _id: string; count: number }>([
        { $match: { ...filter, declineReason: { $exists: true, $ne: '' } } },
        { $group: { _id: '$declineReason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate<{ _id: string; count: number }>([
        { $match: { ...filter, qualityStatus: { $exists: true } } },
        {
          $group: {
            _id: {
              $cond: [
                { $eq: ['$qualityStatus', 'VERIFIED'] },
                'VERIFIED',
                { $cond: [{ $eq: ['$qualityStatus', 'CHECKED'] }, 'CHECKED', 'DRAFT'] },
              ],
            },
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
      collection.aggregate<{ acceptanceCount: number; declineCount: number }>([
        { $match: filter },
        { $group: { _id: null, acceptanceCount: { $sum: '$acceptanceCount' }, declineCount: { $sum: '$declineCount' } } },
      ]).toArray(),
    ])

    const columnCounts: Record<string, number> = {}
    for (const item of columnCountsAgg) columnCounts[item._id || 'UNKNOWN'] = item.count

    const regionCounts: Record<string, number> = {}
    for (const item of regionCountsAgg) regionCounts[item._id || 'UNKNOWN'] = item.count

    const iceScores = iceScoresAgg.map((a: { score: number }) => a.score).filter((s): s is number => typeof s === 'number')
    const sortedIce = iceScores.slice().sort((a: number, b: number) => a - b)

    const avgIce = sortedIce.length > 0 ? sortedIce.reduce((acc: number, s: number) => acc + s, 0) / sortedIce.length : 0
    const medianIce = sortedIce.length > 0 ? sortedIce[Math.floor(sortedIce.length / 2)] : 0

    const readableBuckets = [
      { label: '0-200', min: 0, max: 200, count: 0 },
      { label: '200-400', min: 200, max: 400, count: 0 },
      { label: '400-600', min: 400, max: 600, count: 0 },
      { label: '600-800', min: 600, max: 800, count: 0 },
      { label: '800+', min: 800, max: Infinity, count: 0 },
    ]
    const buckets = readableBuckets.map((b) => ({ ...b }))

    for (const s of iceScores) {
      const bucket = buckets.find((b) => s >= b.min && s < b.max)
      if (bucket) bucket.count++
    }

    const sortedDeclineReasons = declineReasonsAgg.map((item: { _id: string; count: number }) => [
      item._id || 'OTHER',
      item.count,
    ]) as [string, number][]

    const qualityCounts: Record<string, number> = { VERIFIED: 0, CHECKED: 0, DRAFT: 0 }
    for (const item of qualityCountsAgg) {
      const status: string = item._id || 'DRAFT'
      if (status in qualityCounts) {
        qualityCounts[status] = (qualityCounts[status] || 0) + item.count
      }
    }

    const totalWithFeedback = (feedbackAgg[0]?.acceptanceCount || 0) + (feedbackAgg[0]?.declineCount || 0)
    const acceptedWithVerified = qualityCounts.VERIFIED + qualityCounts.CHECKED
    const successRate = totalWithFeedback > 0 ? (acceptedWithVerified / totalWithFeedback) * 100 : 0

    return NextResponse.json({
      brand,
      tenantId,
      fetchedAt: new Date().toISOString(),
      source: 'mongodb',
      metrics: {
        total: totalCount,
        columnCounts,
        regionCounts,
        avgIce,
        medianIce,
        buckets,
        sortedDeclineReasons,
        qualityCounts,
        successRate,
      },
    })
  } catch (error: any) {
    console.error('[API:metrics] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch metrics', details: error.message }, { status: 500 })
  }
}
