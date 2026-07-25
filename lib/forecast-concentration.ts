import type { Db } from 'mongodb'

// Pure concentration-risk computation, mirroring lib/pipeline-weights.ts's
// precedent: the math (computeConcentration) is Mongo-free and independently
// unit-testable; the settings reader (getConcentrationRiskSettings) lives in
// the same file since pipeline-weights.ts does the same thing.

export type LeadValue = {
  leadId: string
  entityName: string
  value: number
}

export type ConcentrationRisk = {
  topLeadId: string
  topLeadName: string
  topLeadValue: number
  percentOfTotal: number
  threshold: number
  topN: number
  atRisk: boolean
}

export const DEFAULT_CONCENTRATION_THRESHOLD = 0.3
export const DEFAULT_CONCENTRATION_TOP_N = 1

// Deterministic ranking (value desc, leadId asc for ties) happens here, not
// in the caller — this function is self-contained regardless of the order
// leadValues arrive in. A zero-or-negative value is excluded from both the
// ranking and the denominator basis (a $0 lead isn't a diversification risk
// or a real contributor). Returns null when there's no positive-value total
// to compute a share of, or a single-lead column (isOnlyLead) never flags —
// there's no diversification decision to make with only one deal.
export function computeConcentration(
  leadValues: LeadValue[],
  totalValue: number,
  columnLeadCount: number,
  threshold: number = DEFAULT_CONCENTRATION_THRESHOLD,
  topN: number = DEFAULT_CONCENTRATION_TOP_N
): ConcentrationRisk | null {
  const positive = leadValues.filter((l) => l.value > 0)
  if (totalValue <= 0 || positive.length === 0) return null

  const sorted = [...positive].sort((a, b) => b.value - a.value || a.leadId.localeCompare(b.leadId))
  const topLeads = sorted.slice(0, Math.max(1, topN))
  const topSum = topLeads.reduce((sum, l) => sum + l.value, 0)
  const percentOfTotal = Math.round((topSum / totalValue) * 1000) / 1000
  const isOnlyLead = columnLeadCount <= topN

  return {
    topLeadId: topLeads[0].leadId,
    topLeadName: topLeads[0].entityName,
    topLeadValue: topLeads[0].value,
    percentOfTotal,
    threshold,
    topN,
    atRisk: percentOfTotal >= threshold && !isOnlyLead,
  }
}

export type ConcentrationRiskSettings = {
  threshold: number
  topN: number
}

export const DEFAULT_CONCENTRATION_SETTINGS: ConcentrationRiskSettings = {
  threshold: DEFAULT_CONCENTRATION_THRESHOLD,
  topN: DEFAULT_CONCENTRATION_TOP_N,
}

export async function getConcentrationRiskSettings(db: Db): Promise<ConcentrationRiskSettings> {
  try {
    const doc = await db.collection('settings').findOne({ key: 'concentration_risk_settings' })
    if (!doc) return DEFAULT_CONCENTRATION_SETTINGS
    const threshold = Number(doc.threshold)
    const topN = Number(doc.topN)
    return {
      threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_CONCENTRATION_SETTINGS.threshold,
      topN: Number.isFinite(topN) && topN > 0 ? Math.round(topN) : DEFAULT_CONCENTRATION_SETTINGS.topN,
    }
  } catch {
    return DEFAULT_CONCENTRATION_SETTINGS
  }
}
