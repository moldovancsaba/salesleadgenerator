import type { Db } from 'mongodb'

// Forecast categories (issue #204) — a rep-editable classification distinct
// from kanbanColumn, mirroring the standard CRM forecast-category concept
// (Pipeline / Best Case / Commit / Closed) sales orgs use for a
// weighted-revenue view that isn't strictly one-weight-per-stage. Pure
// stage-mapping + weighting math lives here (Mongo-free, independently
// unit-testable), same split as lib/win-rate-calibration.ts.

export type ForecastCategory = 'pipeline' | 'best_case' | 'commit' | 'closed' | 'omitted'

export const FORECAST_CATEGORIES: ForecastCategory[] = ['pipeline', 'best_case', 'commit', 'closed', 'omitted']

export const FORECAST_CATEGORY_LABEL: Record<ForecastCategory, string> = {
  pipeline: 'Pipeline',
  best_case: 'Best Case',
  commit: 'Commit',
  closed: 'Closed',
  omitted: 'Omitted',
}

export function isForecastCategory(value: unknown): value is ForecastCategory {
  return typeof value === 'string' && (FORECAST_CATEGORIES as string[]).includes(value)
}

// Default category per kanbanColumn, per the issue's own stage mapping.
// BACKLOG (issue #126) isn't named in the issue's mapping table — treated
// as 'pipeline' (same as DISCOVERED/QUALIFIED), consistent with it being
// excluded from every revenue aggregation as a not-actively-worked lead
// rather than a probability-weighted forecast entry (app/lib/forecast.ts's
// own revenueFilter already excludes BACKLOG from revenue math entirely;
// this mapping only matters if a BACKLOG lead's category is ever displayed).
const STAGE_TO_DEFAULT_CATEGORY: Record<string, ForecastCategory> = {
  DISCOVERED: 'pipeline',
  QUALIFIED: 'pipeline',
  BACKLOG: 'pipeline',
  ENGAGED: 'best_case',
  PROPOSAL: 'commit',
  WON: 'closed',
  LOST: 'closed',
}

export function resolveDefaultCategory(kanbanColumn: string | undefined | null): ForecastCategory {
  return STAGE_TO_DEFAULT_CATEGORY[kanbanColumn || ''] ?? 'pipeline'
}

// A lead never writes forecastCategory at all until a rep explicitly
// overrides it (see app/lib/lead-actions.ts's SET_FORECAST_CATEGORY branch)
// — the default always tracks the lead's current kanbanColumn live, so a
// stage move on a never-overridden lead needs no field to keep in sync.
// Sticky-override semantics (issue #204: "survives subsequent kanbanColumn
// moves") fall out of this for free: only SET_FORECAST_CATEGORY ever writes
// forecastCategoryOverriddenBy, so no other action path can clear it.
export function effectiveForecastCategory(lead: {
  kanbanColumn?: string | null
  forecastCategory?: string | null
  forecastCategoryOverriddenBy?: string | null
}): ForecastCategory {
  if (lead.forecastCategoryOverriddenBy && isForecastCategory(lead.forecastCategory)) {
    return lead.forecastCategory
  }
  return resolveDefaultCategory(lead.kanbanColumn)
}

// closed's flat weight is never actually used by computeCategoryForecast()
// below (closed leads are split WON=full/LOST=zero, same treatment as the
// existing per-stage weight) — kept here only so the settings doc/admin UI
// always has a complete, displayable 5-entry weight table rather than a
// mysteriously-missing row. Omitted deals are weight 0 by default.
export const DEFAULT_FORECAST_CATEGORY_WEIGHTS: Record<ForecastCategory, number> = {
  pipeline: 0.10,
  best_case: 0.40,
  commit: 0.90,
  closed: 1.0,
  omitted: 0.0,
}

export async function getForecastCategoryWeights(db: Db): Promise<Record<ForecastCategory, number>> {
  try {
    const doc = await db.collection('settings').findOne({ key: 'forecast_category_weights' })
    return { ...DEFAULT_FORECAST_CATEGORY_WEIGHTS, ...(doc?.weights || {}) }
  } catch {
    return DEFAULT_FORECAST_CATEGORY_WEIGHTS
  }
}

export async function setForecastCategoryWeights(db: Db, weights: Record<ForecastCategory, number>): Promise<void> {
  await db.collection('settings').updateOne(
    { key: 'forecast_category_weights' },
    { $set: { weights, updatedAt: new Date() } },
    { upsert: true }
  )
}

export type CategoryDealSummary = {
  id: string
  name: string
  value: number
  weightedValue: number
  stage: string
  overridden: boolean
}

export type CategoryBreakdownEntry = {
  leads: number
  rawRevenue: number
  weightedRevenue: number
  weight: number | null
  deals?: CategoryDealSummary[]
}

export type CategoryForecastResult = {
  categoryWeightedRevenue: number
  byCategory: Record<ForecastCategory, CategoryBreakdownEntry>
  categoryWeightsUsed: Record<ForecastCategory, number>
}

export type PerLeadCategoryInput = {
  _id?: any
  id?: string
  entity_name?: string
  name?: string
  kanbanColumn?: string | null
  value?: number
  forecastCategory?: string | null
  forecastCategoryOverriddenBy?: string | null
}

// Additive companion to the existing per-stage totalWeightedRevenue —
// never replaces it. `closed` is deliberately NOT a flat weight: a lead
// whose effective category is 'closed' gets WON's full value or LOST's
// zero value, exactly like the existing stage-weighted treatment
// (weightsUsed.WON === 1.0, weightsUsed.LOST === 0.0 by default) rather
// than a category-level constant — closed IS the WON/LOST split, a flat
// weight there would double-count or mis-weight it. `weight` on the
// 'closed' row of byCategory is reported as null for the same reason: no
// single number applies to that bucket. Omitted leads contribute 0 to
// total weighted revenue (omitted weight defaults to 0).
export function computeCategoryForecast(
  perLeadDocs: PerLeadCategoryInput[],
  categoryWeights: Record<ForecastCategory, number>,
  stageWeightsUsed: Record<string, number>
): CategoryForecastResult {
  const byCategory: Record<ForecastCategory, CategoryBreakdownEntry> = {
    pipeline: { leads: 0, rawRevenue: 0, weightedRevenue: 0, weight: categoryWeights.pipeline, deals: [] },
    best_case: { leads: 0, rawRevenue: 0, weightedRevenue: 0, weight: categoryWeights.best_case, deals: [] },
    commit: { leads: 0, rawRevenue: 0, weightedRevenue: 0, weight: categoryWeights.commit, deals: [] },
    closed: { leads: 0, rawRevenue: 0, weightedRevenue: 0, weight: null, deals: [] },
    omitted: { leads: 0, rawRevenue: 0, weightedRevenue: 0, weight: categoryWeights.omitted ?? 0, deals: [] },
  }

  let total = 0
  for (const doc of perLeadDocs) {
    const category = effectiveForecastCategory(doc)
    const value = doc.value || 0
    let weight: number
    if (category === 'closed') {
      const col = doc.kanbanColumn || ''
      weight = col === 'WON' ? 1 : col === 'LOST' ? 0 : (stageWeightsUsed[col] ?? 0)
    } else {
      weight = categoryWeights[category] ?? 0
    }
    const weightedValue = value * weight
    byCategory[category].leads += 1
    byCategory[category].rawRevenue += value
    byCategory[category].weightedRevenue += weightedValue
    total += weightedValue

    const leadId = doc._id ? String(doc._id) : (doc.id || '')
    const leadName = doc.entity_name || doc.name || 'Untitled'
    byCategory[category].deals!.push({
      id: leadId,
      name: leadName,
      value: Math.round(value),
      weightedValue: Math.round(weightedValue),
      stage: doc.kanbanColumn || 'UNKNOWN',
      overridden: Boolean(doc.forecastCategoryOverriddenBy),
    })
  }

  for (const cat of FORECAST_CATEGORIES) {
    byCategory[cat].weightedRevenue = Math.round(byCategory[cat].weightedRevenue)
    byCategory[cat].rawRevenue = Math.round(byCategory[cat].rawRevenue)
    byCategory[cat].deals!.sort((a, b) => b.value - a.value || b.weightedValue - a.weightedValue)
    if (byCategory[cat].deals!.length > 25) {
      byCategory[cat].deals = byCategory[cat].deals!.slice(0, 25)
    }
  }

  return {
    categoryWeightedRevenue: Math.round(total),
    byCategory,
    categoryWeightsUsed: categoryWeights,
  }
}
