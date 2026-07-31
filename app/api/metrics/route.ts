import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { computeVelocity } from '@/app/lib/velocity-metrics'
import type { OutcomeLogRow } from '@/app/lib/velocity-metrics'
import { correlateOutcomes } from '@/lib/outcome-correlation'
import { getTenantId, tenantFilter } from '@/lib/tenant'

const VELOCITY_PERIOD_DAYS = 30
// Two full periods back from now, so the query covers both the current and
// prior comparison windows without scanning the whole outcomelogs history.
const VELOCITY_LOOKBACK_MS = VELOCITY_PERIOD_DAYS * 2 * 86_400_000
const VELOCITY_ROW_CAP = 20_000
// Issue #74: correlation looks at all-time outcome history (not a rolling
// window like velocity above), so it needs its own, separate cap.
const CORRELATION_ROW_CAP = 20_000
const CORRELATION_MIN_SAMPLE_SIZE = 10
// searchlearnings has no tenant/brand scoping (single global companyId,
// confirmed via source — see docs/ARCHITECTURE.md's "Outcome-learning
// report" section) — this is a real, disclosed limitation, not an oversight.
const SEARCH_LEARNING_COMPANY_ID = 'slg'

const COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'] as const
const REGIONS = ['US', 'CEE', 'MENA'] as const

// outcomelogs has no `brand` field (a single shared collection keyed only by
// leadId) and an inconsistent `tenantId` (the generic POST /api/outcome-logs
// path never writes it, unlike executeLeadAction's own insert) — so a
// brand/tenant-scoped velocity query must resolve the set of leadIds
// belonging to this brand/tenant first, then join outcomelogs on that set,
// rather than trusting outcomelogs.tenantId alone (issue #58).
async function computeVelocityMetrics(db: any, leadsCollection: any, leadsFilter: Record<string, any>) {
  const leadDocs = await leadsCollection
    .find(leadsFilter, { projection: { _id: 1, createdAt: 1 } })
    .toArray()

  const leadIds = leadDocs.map((d: any) => d._id.toString())
  const leadCreatedAt: Record<string, Date | string> = {}
  for (const doc of leadDocs) {
    if (doc.createdAt) leadCreatedAt[doc._id.toString()] = doc.createdAt
  }

  if (leadIds.length === 0) {
    return { ...computeVelocity([], {}, new Date(), VELOCITY_PERIOD_DAYS), truncated: false }
  }

  const lookbackCutoff = new Date(Date.now() - VELOCITY_LOOKBACK_MS)
  const rawLogs = await db.collection('outcomelogs')
    .find(
      { leadId: { $in: leadIds }, createdAt: { $gte: lookbackCutoff } },
      { projection: { leadId: 1, createdAt: 1, beforeState: 1, afterState: 1 }, limit: VELOCITY_ROW_CAP + 1 }
    )
    .toArray()

  const truncated = rawLogs.length > VELOCITY_ROW_CAP
  const logs: OutcomeLogRow[] = (truncated ? rawLogs.slice(0, VELOCITY_ROW_CAP) : rawLogs).map((l: any) => ({
    leadId: l.leadId,
    createdAt: l.createdAt,
    beforeState: l.beforeState,
    afterState: l.afterState,
  }))

  const velocity = computeVelocity(logs, leadCreatedAt, new Date(), VELOCITY_PERIOD_DAYS)
  return { ...velocity, truncated }
}

// Issue #74 — reuses the same leadIds-then-join pattern computeVelocityMetrics
// established above, but over all-time outcome history rather than a rolling
// window (correlation needs the full signal, not just the last 30 days).
async function computeOutcomeCorrelationMetrics(db: any, leadsCollection: any, leadsFilter: Record<string, any>) {
  const leadDocs = await leadsCollection
    .find(leadsFilter, { projection: { _id: 1, industry: 1 } })
    .toArray()

  const leadIds = leadDocs.map((d: any) => d._id.toString())
  const leadIndustryById = new Map<string, string | undefined>(
    leadDocs.map((d: any) => [d._id.toString(), d.industry])
  )

  const rawLogs = leadIds.length
    ? await db.collection('outcomelogs')
        .find(
          { leadId: { $in: leadIds }, 'afterState.kanbanColumn': { $in: ['WON', 'LOST'] } },
          { projection: { leadId: 1, afterState: 1, teachingWeight: 1 }, limit: CORRELATION_ROW_CAP + 1 }
        )
        .toArray()
    : []

  const truncated = rawLogs.length > CORRELATION_ROW_CAP
  const outcomeLogs = (truncated ? rawLogs.slice(0, CORRELATION_ROW_CAP) : rawLogs).map((l: any) => ({
    leadId: l.leadId,
    afterState: l.afterState,
    teachingWeight: l.teachingWeight,
  }))

  const searchLearning = await db.collection('searchlearnings').findOne({ companyId: SEARCH_LEARNING_COMPANY_ID })
  const searchQueries = Array.isArray(searchLearning?.topQueries) ? searchLearning.topQueries : null

  const correlation = correlateOutcomes(outcomeLogs, leadIndustryById, searchQueries, CORRELATION_MIN_SAMPLE_SIZE)
  return { ...correlation, truncated, searchQueryDataIsGlobal: true }
}

export async function GET(request: Request) {
  try {
    const brand = resolveBrand(new URL(request.url).searchParams.get('brand') || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
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

    // Velocity failure degrades only this one key, never the whole response
    // (Operational Behavior, issue #58) — the rest of /api/metrics is
    // independently useful even if outcomelogs is unreachable/malformed.
    let velocity = null
    try {
      velocity = await computeVelocityMetrics(db, collection, filter)
    } catch (velocityError: any) {
      console.error('[API:metrics] velocity computation error:', velocityError)
    }

    // Same graceful-degradation contract as velocity above (issue #74).
    let outcomeCorrelation = null
    try {
      outcomeCorrelation = await computeOutcomeCorrelationMetrics(db, collection, filter)
    } catch (correlationError: any) {
      console.error('[API:metrics] outcome correlation computation error:', correlationError)
    }

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
        velocity,
        outcomeCorrelation,
      },
    })
  } catch (error: any) {
    console.error('[API:metrics] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch metrics', details: error.message }, { status: 500 })
  }
}
