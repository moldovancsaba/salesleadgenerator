import type { Db } from 'mongodb'
import { BRAND_CONFIG } from './brand'
import { getPipelineWeights } from '../../lib/pipeline-weights'
import { tenantFilter } from '../../lib/tenant'
import { computeConcentration, getConcentrationRiskSettings } from '../../lib/forecast-concentration'
import type { LeadValue, ConcentrationRiskSettings } from '../../lib/forecast-concentration'
import { computeCoverage } from '../../lib/pipeline-coverage'
import type { RevenueTargetInput } from '../../lib/pipeline-coverage'
import { getForecastCalibrationSettings, mergeCalibratedWeights } from '../../lib/win-rate-calibration'
import { getCachedWinRates } from './win-rate-store'

// CogMap forecasts in USD, Seyu in EUR — matches app/lib/sales-settings.ts's
// defaultRevenueTargetCurrency(), the source of truth this mirrors.
const FORECAST_CURRENCY: Record<'cogmap' | 'seyu', 'USD' | 'EUR'> = { cogmap: 'USD', seyu: 'EUR' }

// Coverage is looked up under the exact same {brand, tenantId} key
// app/api/sales-settings/[brand]/route.ts's own GET/PUT already use — not
// lib/tenant.ts's tenantFilter() $or-default special-casing, an exact match
// against whatever tenantId this computeForecast() call itself received.
async function fetchRevenueTarget(db: Db, brand: string, tenantId: string): Promise<RevenueTargetInput | null> {
  try {
    const doc = await db.collection('company_settings').findOne({ brand, tenantId })
    if (!doc?.revenueTarget) return null
    return doc.revenueTarget as RevenueTargetInput
  } catch (error) {
    console.error('[app/lib/forecast] revenue target lookup failed', { brand, tenantId, error })
    return null
  }
}

const PIPELINE_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']

type PerLeadValueDoc = { _id: any; entity_name?: string; kanbanColumn?: string; value?: number }

// Attaches per-column concentrationRisk (raw basis) to each pipeline[col]
// entry, and returns the brand-level concentrationRisk (weighted basis —
// rawValue * that column's own close probability, since a large deal in
// DISCOVERED contributes far less real risk than the same value in WON).
// A lead with $topN (MongoDB >=5.2) would fetch this more cheaply server-side,
// but that server-version support can't be verified against a live cluster
// from this sandbox — this fetches every positive-value lead's own value
// instead and ranks/slices in plain JS, which works on any Mongo version and
// avoids depending on an unverifiable capability (issue #59).
function attachConcentrationRisk(
  perLeadDocs: PerLeadValueDoc[],
  pipeline: Record<string, any>,
  totalWeighted: number,
  weightsUsed: Record<string, number>,
  settings: ConcentrationRiskSettings
): ReturnType<typeof computeConcentration> {
  const leadValuesByColumn: Record<string, LeadValue[]> = {}
  for (const doc of perLeadDocs) {
    const col = doc.kanbanColumn || 'UNKNOWN'
    const lv: LeadValue = { leadId: doc._id.toString(), entityName: doc.entity_name || 'Unknown', value: doc.value || 0 }
    ;(leadValuesByColumn[col] ??= []).push(lv)
  }

  for (const col of PIPELINE_COLUMNS) {
    const values = leadValuesByColumn[col] || []
    const positiveCount = values.filter((v) => v.value > 0).length
    const rawRevenue = pipeline[col]?.rawRevenue ?? 0
    if (pipeline[col]) {
      pipeline[col].concentrationRisk = computeConcentration(values, rawRevenue, positiveCount, settings.threshold, settings.topN)
    }
  }

  const weightedValues: LeadValue[] = []
  for (const [col, values] of Object.entries(leadValuesByColumn)) {
    const weight = weightsUsed[col] ?? 0
    for (const v of values) {
      weightedValues.push({ ...v, value: v.value * weight })
    }
  }
  const weightedPositiveCount = weightedValues.filter((v) => v.value > 0).length
  return computeConcentration(weightedValues, totalWeighted, weightedPositiveCount, settings.threshold, settings.topN)
}

// Extracted from app/api/boards/[brand]/route.ts (issue #57) so the live
// board endpoint and the forecast-snapshot endpoint can never drift —
// both call this same function. No behavior change to the board API
// response: the extra `weightsUsed` field this returns is deliberately
// omitted by the board route when assembling its own JSON response.
export type ForecastComputation = {
  totalLeads: number
  updatedAt: string
  columnCounts: Record<string, number>
  regionCounts: Record<string, number>
  forecast: Record<string, any> | null
  weightsUsed: Record<string, number>
}

export async function computeForecast(db: Db, brand: 'cogmap' | 'seyu', tenantId: string): Promise<ForecastComputation> {
  const config = BRAND_CONFIG[brand]
  const filter = tenantFilter(tenantId)
  const collection = db.collection(config.dbCollection)

  const totalLeads = await collection.countDocuments(filter)
  const updatedAt = new Date().toISOString()

  const byColumnCursor = await collection.aggregate([
    { $match: filter },
    { $group: { _id: '$kanbanColumn', count: { $sum: 1 } } },
  ]).toArray()

  const byRegionCursor = await collection.aggregate([
    { $match: filter },
    { $group: { _id: '$region', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray()

  const columnCounts: Record<string, number> = {}
  for (const item of byColumnCursor) {
    columnCounts[item._id || 'UNKNOWN'] = item.count
  }

  const regionCounts: Record<string, number> = {}
  for (const item of byRegionCursor) {
    regionCounts[item._id || 'UNKNOWN'] = item.count
  }

  let forecast: Record<string, any> | null = null
  const staticWeights = await getPipelineWeights(db)
  const calibrationSettings = await getForecastCalibrationSettings(db)
  // Cached-read only — recompute never happens on this hot path (issue #56).
  // GET /api/win-rates is the sole lazy-recompute trigger; POST
  // /api/win-rates/recalculate is the sole manual-recompute trigger.
  const cachedWinRates = calibrationSettings.mode === 'calibrated'
    ? await getCachedWinRates(db, brand, tenantId)
    : null
  const { weightsUsed, sources: probabilitySources } = mergeCalibratedWeights(
    staticWeights,
    cachedWinRates?.stages ?? null,
    calibrationSettings.mode,
    calibrationSettings.minSampleSize
  )
  const calibrationInfo = {
    mode: calibrationSettings.mode,
    lastComputedAt: cachedWinRates?.computedAt ? new Date(cachedWinRates.computedAt).toISOString() : null,
  }

  // Ticket-size estimate (issue #79) takes priority over the legacy
  // free-written estimated_annual_revenue_usd field once computed — same
  // fallback contract as app/constants.ts's getTicketSize() (issue #79/#80),
  // so the forecast and the lead-detail UI never disagree about which
  // number is authoritative for a given lead (issue #85).
  const REVENUE_EXPR = { $ifNull: ['$ticketSizeEstimate.expected', { $ifNull: ['$estimated_annual_revenue_usd', 0] }] }

  if (brand === 'cogmap') {
    const pipelineForecast = await collection.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$kanbanColumn',
          leads: { $sum: 1 },
          participants: { $sum: { $ifNull: ['$estimated_participants', 0] } },
          revenue: { $sum: REVENUE_EXPR },
        },
      },
    ]).toArray()

    const pipelineColumns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']
    const rawByColumn: Record<string, any> = {}
    for (const item of pipelineForecast) {
      rawByColumn[(item._id || 'UNKNOWN') as string] = item
    }

    const pipeline: Record<string, any> = {}
    for (const col of pipelineColumns) {
      const item = rawByColumn[col] || { leads: 0, participants: 0, revenue: 0 }
      const rate = weightsUsed[col] ?? 0
      pipeline[col] = {
        leads: item.leads,
        participants: item.participants,
        rawRevenue: item.revenue,
        probability: rate,
        weightedRevenue: Math.round(item.revenue * rate),
        probabilitySource: probabilitySources[col] ?? 'static',
      }
    }

    const totalWeighted = Object.values(pipeline as Record<string, { weightedRevenue: number }>)
      .reduce((sum: number, col) => sum + (col.weightedRevenue || 0), 0)

    const revenueByModel = await collection.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$revenue_model',
          leads: { $sum: 1 },
          revenue: { $sum: REVENUE_EXPR },
        },
      },
      { $sort: { revenue: -1 } },
    ]).toArray()

    const totalRevenue = await collection.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          revenue: { $sum: REVENUE_EXPR },
          participants: { $sum: { $ifNull: ['$estimated_participants', 0] } },
        },
      },
    ]).toArray()

    const perLeadValues = await collection.aggregate<PerLeadValueDoc>([
      { $match: filter },
      { $project: { entity_name: 1, kanbanColumn: 1, value: REVENUE_EXPR } },
    ]).toArray()
    const concentrationSettings = await getConcentrationRiskSettings(db)
    const brandConcentrationRisk = attachConcentrationRisk(perLeadValues, pipeline, totalWeighted, weightsUsed, concentrationSettings)
    const revenueTarget = await fetchRevenueTarget(db, brand, tenantId)
    const coverage = computeCoverage(revenueTarget, totalWeighted, FORECAST_CURRENCY[brand])

    forecast = {
      pipeline,
      totalWeightedRevenue: totalWeighted,
      concentrationRisk: brandConcentrationRisk,
      coverage,
      calibration: calibrationInfo,
      byTier: pipelineForecast.reduce((acc: Record<string, { leads: number; participants: number; revenue: number }>, item: any) => {
        acc[item._id || 'UNSET'] = { leads: item.leads, participants: item.participants, revenue: item.revenue }
        return acc
      }, {}),
      byModel: revenueByModel.reduce((acc: Record<string, { leads: number; revenue: number }>, item: any) => {
        acc[item._id || 'UNSET'] = { leads: item.leads, revenue: item.revenue }
        return acc
      }, {}),
      totals: totalRevenue[0] || { revenue: 0, participants: 0 },
    }
  }

  if (brand === 'seyu') {
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
      estimatedAnnualValueEur: Math.max(
        doc.annualEur || 0,
        ((doc.monthlyEur || 0) * 12) + (doc.upfrontEur || 0)
      ),
    }))

    const totalAnnualized = annualizedByCompany.reduce((sum: number, item: { estimatedAnnualValueEur: number }) => sum + (item.estimatedAnnualValueEur || 0), 0)

    // Per-column pipeline-weighted ("discounted") forecast, mirroring cogmap's
    // shape: each lead's own pricingByCompany entries are summed per-lead
    // (max(annual, monthly*12+upfront) per entry) before grouping by column,
    // so a lead with multiple company blocks isn't double counted per entry.
    const seyuColumnForecast = await collection.aggregate([
      { $match: filter },
      {
        $project: {
          kanbanColumn: 1,
          companyPricing: { $objectToArray: { $ifNull: ['$pricingByCompany', {}] } },
        },
      },
      {
        $addFields: {
          leadValue: {
            $sum: {
              $map: {
                input: '$companyPricing',
                as: 'entry',
                in: {
                  $max: [
                    { $ifNull: ['$$entry.v.annual_fee_eur', 0] },
                    {
                      $add: [
                        { $multiply: [{ $ifNull: ['$$entry.v.monthly_eur', 0] }, 12] },
                        { $ifNull: ['$$entry.v.upfront_eur', 0] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: '$kanbanColumn',
          leads: { $sum: 1 },
          revenue: { $sum: '$leadValue' },
        },
      },
    ]).toArray()

    const pipelineColumnsSeyu = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']
    const rawByColumnSeyu: Record<string, any> = {}
    for (const item of seyuColumnForecast) {
      rawByColumnSeyu[(item._id || 'UNKNOWN') as string] = item
    }

    const pipelineSeyu: Record<string, any> = {}
    for (const col of pipelineColumnsSeyu) {
      const item = rawByColumnSeyu[col] || { leads: 0, revenue: 0 }
      const rate = weightsUsed[col] ?? 0
      pipelineSeyu[col] = {
        leads: item.leads,
        rawRevenue: item.revenue,
        probability: rate,
        weightedRevenue: Math.round(item.revenue * rate),
        probabilitySource: probabilitySources[col] ?? 'static',
      }
    }

    const totalWeightedSeyu = Object.values(pipelineSeyu as Record<string, { weightedRevenue: number }>)
      .reduce((sum: number, col) => sum + (col.weightedRevenue || 0), 0)

    // Same per-lead leadValue computation as seyuColumnForecast above, minus
    // the final $group — concentration ranking needs individual lead values,
    // not just the per-column sum.
    const perLeadValuesSeyu = await collection.aggregate<PerLeadValueDoc>([
      { $match: filter },
      {
        $project: {
          entity_name: 1,
          kanbanColumn: 1,
          companyPricing: { $objectToArray: { $ifNull: ['$pricingByCompany', {}] } },
        },
      },
      {
        $project: {
          entity_name: 1,
          kanbanColumn: 1,
          value: {
            $sum: {
              $map: {
                input: '$companyPricing',
                as: 'entry',
                in: {
                  $max: [
                    { $ifNull: ['$$entry.v.annual_fee_eur', 0] },
                    {
                      $add: [
                        { $multiply: [{ $ifNull: ['$$entry.v.monthly_eur', 0] }, 12] },
                        { $ifNull: ['$$entry.v.upfront_eur', 0] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ]).toArray()
    const concentrationSettingsSeyu = await getConcentrationRiskSettings(db)
    const brandConcentrationRiskSeyu = attachConcentrationRisk(perLeadValuesSeyu, pipelineSeyu, totalWeightedSeyu, weightsUsed, concentrationSettingsSeyu)
    const revenueTargetSeyu = await fetchRevenueTarget(db, brand, tenantId)
    const coverageSeyu = computeCoverage(revenueTargetSeyu, totalWeightedSeyu, FORECAST_CURRENCY[brand])

    forecast = {
      byCompany: annualizedByCompany,
      totalEstimatedAnnualValueEur: totalAnnualized,
      pipeline: pipelineSeyu,
      totalWeightedRevenue: totalWeightedSeyu,
      concentrationRisk: brandConcentrationRiskSeyu,
      coverage: coverageSeyu,
      calibration: calibrationInfo,
      currency: 'EUR',
    }
  }

  return { totalLeads, updatedAt, columnCounts, regionCounts, forecast, weightsUsed }
}
