import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { BRAND_CONFIG } from '../../lib/brand'

const DEFAULT_WEIGHTS: Record<string, number> = {
  DISCOVERED: 0.01,
  QUALIFIED: 0.05,
  ENGAGED: 0.10,
  PROPOSAL: 0.25,
  WON: 1.0,
  LOST: 0.0,
}

async function getPipelineWeights(): Promise<Record<string, number>> {
  try {
    const client = await clientPromise
    const db = client.db()
    const doc = await db.collection('settings').findOne({ key: 'pipeline_weights' })
    return doc?.weights || DEFAULT_WEIGHTS
  } catch {
    return DEFAULT_WEIGHTS
  }
}

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function tenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId }
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const filter = tenantFilter(tenantId)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ brands: {}, total: 0, source: 'default' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const brands: Record<string, { total: number; byColumn: Record<string, number>; byRegion: Record<string, number>; forecast?: Record<string, any> | null }> = {}
    let total = 0

    for (const [brandKey, config] of Object.entries(BRAND_CONFIG)) {
      const collection = db.collection(config.dbCollection)
      const brandTotal = await collection.countDocuments(filter)
      total += brandTotal

      const byColumn = await collection
        .aggregate([
          { $match: filter },
          { $group: { _id: '$kanbanColumn', count: { $sum: 1 } } },
        ])
        .toArray()

      const byRegion = await collection
        .aggregate([
          { $match: filter },
          { $group: { _id: '$region', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray()

      let forecast = null
      if (brandKey === 'cogmap') {
        const pipelineForecast = await collection.aggregate([
          { $match: filter },
          {
            $group: {
              _id: '$kanbanColumn',
              leads: { $sum: 1 },
              participants: { $sum: { $ifNull: ['$estimated_participants', 0] } },
              revenue: { $sum: { $ifNull: ['$estimated_annual_revenue_usd', 0] } },
            },
          },
        ]).toArray()

        const closedRates = await getPipelineWeights()

        const pipelineColumns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']
        const rawByColumn: Record<string, any> = {}
        for (const item of pipelineForecast) {
          rawByColumn[(item._id || 'UNKNOWN') as string] = item
        }

        const pipeline: Record<string, any> = {}
        for (const col of pipelineColumns) {
          const item = rawByColumn[col] || { leads: 0, participants: 0, revenue: 0 }
          const rate = closedRates[col] ?? 0
          pipeline[col] = {
            leads: item.leads,
            participants: item.participants,
            rawRevenue: item.revenue,
            probability: rate,
            weightedRevenue: Math.round(item.revenue * rate),
          }
        }

        const totalWeighted = Object.values(pipeline).reduce((sum: number, col: any) => sum + (col.weightedRevenue || 0), 0)

        const revenueByModel = await collection.aggregate([
          { $match: filter },
          {
            $group: {
              _id: '$revenue_model',
              leads: { $sum: 1 },
              revenue: { $sum: { $ifNull: ['$estimated_annual_revenue_usd', 0] } },
            },
          },
          { $sort: { revenue: -1 } },
        ]).toArray()

        const totalRevenue = await collection.aggregate([
          { $match: filter },
          { $group: { _id: null, revenue: { $sum: { $ifNull: ['$estimated_annual_revenue_usd', 0] } }, participants: { $sum: { $ifNull: ['$estimated_participants', 0] } } } },
        ]).toArray()

        forecast = {
          pipeline,
          totalWeightedRevenue: totalWeighted,
          byTier: pipelineForecast.reduce((acc: Record<string, any>, item: any) => ({ ...acc, [item._id || 'UNSET']: { leads: item.leads, participants: item.participants, revenue: item.revenue } }), {}),
          byModel: revenueByModel.reduce((acc: Record<string, any>, item: any) => ({ ...acc, [item._id || 'UNSET']: { leads: item.leads, revenue: item.revenue } }), {}),
          totals: totalRevenue[0] || { revenue: 0, participants: 0 },
        }
      }

      if (brandKey === 'seyu') {
        const seyuForecast = await collection.aggregate([
          { $match: filter },
          { $project: { companyPricing: { $objectToArray: '$pricingByCompany' } } },
          { $unwind: { path: '$companyPricing', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$companyPricing.k',
              leads: { $sum: 1 },
              currency: { $first: { $ifNull: ['$companyPricing.v.currency', 'EUR'] } },
              upfrontEur: { $sum: { $ifNull: ['$companyPricing.v.upfront_eur', 0] } },
              monthlyEur: { $sum: { $ifNull: ['$companyPricing.v.monthly_eur', 0] } },
              annualEur: { $sum: { $ifNull: ['$companyPricing.v.annual_fee_eur', 0] } },
              revenueSharePercent: { $max: { $ifNull: ['$companyPricing.v.revenue_share_percent', 0] } },
              discountPercent: { $max: { $ifNull: ['$companyPricing.v.discount_percent', 0] } },
            },
          },
          { $sort: { leads: -1 } },
        ]).toArray()

        const annualizedByCompany = (seyuForecast || []).map((doc: any) => ({
          company: doc._id || 'UNKNOWN',
          leads: doc.leads || 0,
          currency: doc.currency || 'EUR',
          upfrontEur: doc.upfrontEur || 0,
          monthlyEur: doc.monthlyEur || 0,
          annualFeeEur: doc.annualEur || 0,
          revenueSharePercent: doc.revenueSharePercent || 0,
          discountPercent: doc.discountPercent || 0,
          estimatedAnnualValueEur: Math.max(doc.annualEur || 0, ((doc.monthlyEur || 0) * 12) + (doc.upfrontEur || 0)),
        }))

        const totalAnnualized = annualizedByCompany.reduce((sum: number, item: any) => sum + (item.estimatedAnnualValueEur || 0), 0)
        forecast = {
          byCompany: annualizedByCompany,
          totalEstimatedAnnualValueEur: totalAnnualized,
        }
      }

      brands[brandKey] = {
        total: brandTotal,
        byColumn: byColumn.reduce((acc, item) => ({ ...acc, [item._id || 'UNKNOWN']: item.count }), {}),
        byRegion: byRegion.reduce((acc, item) => ({ ...acc, [item._id || 'UNKNOWN']: item.count }), {}),
        forecast,
      }
    }

    return NextResponse.json({
      total,
      brands,
      tenantId,
      source: 'mongodb',
      fetchedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API:stats] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch stats', details: error.message }, { status: 500 })
  }
}
