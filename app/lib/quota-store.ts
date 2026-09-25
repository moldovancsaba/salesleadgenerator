import type { Db } from 'mongodb'
import { getBrandConfig } from './brand'
import type { Brand } from './brand'
import { tenantFilter } from '../../lib/tenant'
import {
  dealValueForLead,
  computeAttainmentFromWonLeads,
  computeAttainmentPercent,
  getQuotaTarget,
  periodToDateRange,
} from '../../lib/quota'
import type { PeriodType, WonLeadEntry } from '../../lib/quota'

export type QuotaAttainment = {
  userId: string
  period: string
  periodType: PeriodType
  quotaAmount: number | null
  currency: string | null
  attained: number
  leadCount: number
  attainmentPercent: number | null
}

// Joins this brand's own WON leads (assignedTo=userId) against outcomelogs
// to find each lead's first WON-transition timestamp — the same
// replay-the-audit-trail approach lib/win-rate-calibration.ts's
// computeWinRatesFromLogs() already uses to reconstruct stage history,
// applied here to answer "when did this lead actually close" rather than
// "what stages did it pass through". A WON lead with no matching
// outcomelog (shouldn't happen via the normal ACCEPT/COLUMN_MOVE/DECLINE
// paths, which always write one) is excluded rather than guessed at —
// never fabricate a close date.
export async function getQuotaAttainment(
  db: Db,
  brand: Brand,
  tenantId: string,
  userId: string,
  period: string,
  periodType: PeriodType
): Promise<QuotaAttainment | null> {
  const range = periodToDateRange(period, periodType)
  if (!range) return null

  const config = await getBrandConfig(brand)
  if (!config) return null

  const filter = tenantFilter(tenantId)
  const leads = await db.collection(config.dbCollection).find({
    ...filter,
    assignedTo: userId,
    kanbanColumn: 'WON',
  }).project({
    _id: 1,
    actualDealValueUsd: 1,
    deals: 1,
    ticketSizeEstimate: 1,
    estimated_annual_revenue_usd: 1,
  }).toArray()

  const wonEntries: WonLeadEntry[] = []
  if (leads.length > 0) {
    const leadIds = leads.map((l: any) => l._id.toString())
    const wonLogs = await db.collection('outcomelogs').find({
      leadId: { $in: leadIds },
      'afterState.kanbanColumn': 'WON',
      tenantId,
    }).sort({ createdAt: 1 }).toArray()

    const firstWonAt = new Map<string, Date>()
    for (const log of wonLogs) {
      if (!firstWonAt.has(log.leadId)) firstWonAt.set(log.leadId, new Date(log.createdAt))
    }

    for (const lead of leads) {
      const id = lead._id.toString()
      const wonAt = firstWonAt.get(id)
      if (!wonAt) continue
      wonEntries.push({ leadId: id, wonAt, value: dealValueForLead(lead) })
    }
  }

  const { attained, leadCount } = computeAttainmentFromWonLeads(wonEntries, range)
  const quota = await getQuotaTarget(db, brand, userId, period)

  return {
    userId,
    period,
    periodType,
    quotaAmount: quota?.amount ?? null,
    currency: quota?.currency ?? null,
    attained,
    leadCount,
    attainmentPercent: computeAttainmentPercent(attained, quota?.amount ?? null),
  }
}
