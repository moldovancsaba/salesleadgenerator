import type { Db } from 'mongodb'

// Quota attainment tracking (issue #204) — mirrors lib/teams.ts's own split
// (pure period/value math here, Mongo reads/writes alongside it since this
// module owns a single simple collection with no cross-collection Mongo
// aggregation of its own — the WON-lead + outcomelogs join that attainment
// needs lives in app/lib/quota-store.ts instead, same layering as
// app/lib/win-rate-store.ts sitting above lib/win-rate-calibration.ts).

export const QUOTA_COLLECTION = 'quota_targets'

export type PeriodType = 'monthly' | 'quarterly' | 'annual'

export const PERIOD_TYPES: PeriodType[] = ['monthly', 'quarterly', 'annual']

const MONTHLY_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTERLY_RE = /^\d{4}-Q[1-4]$/
const ANNUAL_RE = /^\d{4}$/

export function isValidPeriod(period: unknown, periodType: PeriodType): period is string {
  if (typeof period !== 'string') return false
  if (periodType === 'monthly') return MONTHLY_RE.test(period)
  if (periodType === 'quarterly') return QUARTERLY_RE.test(period)
  if (periodType === 'annual') return ANNUAL_RE.test(period)
  return false
}

export type DateRange = { start: Date; end: Date }

// UTC throughout — a quota period is a calendar bucket, not a rep-local-
// timezone one; this app has no per-user timezone concept anywhere else
// (see docs/LESSONS_LEARNED.md for other UTC-by-default precedent).
export function periodToDateRange(period: string, periodType: PeriodType): DateRange | null {
  if (!isValidPeriod(period, periodType)) return null

  if (periodType === 'monthly') {
    const [y, m] = period.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1))
    return { start, end }
  }

  if (periodType === 'quarterly') {
    const [yStr, qStr] = period.split('-Q')
    const y = Number(yStr)
    const q = Number(qStr)
    const startMonth = (q - 1) * 3
    const endYear = startMonth + 3 >= 12 ? y + 1 : y
    const endMonth = (startMonth + 3) % 12
    return { start: new Date(Date.UTC(y, startMonth, 1)), end: new Date(Date.UTC(endYear, endMonth, 1)) }
  }

  const y = Number(period)
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) }
}

// Precedence for "what a WON lead is actually worth" for attainment
// purposes: actualDealValueUsd (issue #83 — "the real, closed contract
// value ... once a lead is WON", captured via MODIFY, never computed) is
// the authoritative figure once it exists, since attainment is measuring
// real closed revenue against a quota, not a pipeline estimate. Falls back
// through the same deals-sum / ticketSizeEstimate.expected /
// estimated_annual_revenue_usd chain app/lib/forecast.ts's REVENUE_EXPR
// already uses for the live (still-open) forecast, so a WON lead whose real
// value was never separately captured still counts at its best known
// estimate rather than $0 — an honest "we don't have a truer number yet"
// fallback, not a fabricated one.
export function dealValueForLead(lead: {
  actualDealValueUsd?: number
  deals?: Array<{ value?: number }>
  ticketSizeEstimate?: { expected?: number }
  estimated_annual_revenue_usd?: number
}): number {
  if (typeof lead.actualDealValueUsd === 'number' && Number.isFinite(lead.actualDealValueUsd)) {
    return lead.actualDealValueUsd
  }
  if (Array.isArray(lead.deals) && lead.deals.length > 0) {
    return lead.deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
  }
  if (typeof lead.ticketSizeEstimate?.expected === 'number' && Number.isFinite(lead.ticketSizeEstimate.expected)) {
    return lead.ticketSizeEstimate.expected
  }
  if (typeof lead.estimated_annual_revenue_usd === 'number' && Number.isFinite(lead.estimated_annual_revenue_usd)) {
    return lead.estimated_annual_revenue_usd
  }
  return 0
}

export type WonLeadEntry = { leadId: string; wonAt: Date; value: number }

// Pure filter+sum so the period-boundary math is independently unit-
// testable without a live database — the WON-lead/outcomelogs join that
// produces wonLeadEntries lives in app/lib/quota-store.ts.
export function computeAttainmentFromWonLeads(wonLeadEntries: WonLeadEntry[], range: DateRange): { attained: number; leadCount: number } {
  let attained = 0
  let leadCount = 0
  for (const entry of wonLeadEntries) {
    if (entry.wonAt >= range.start && entry.wonAt < range.end) {
      attained += entry.value
      leadCount += 1
    }
  }
  return { attained: Math.round(attained), leadCount }
}

export function computeAttainmentPercent(attained: number, quotaAmount: number | null): number | null {
  if (quotaAmount === null || !Number.isFinite(quotaAmount) || quotaAmount <= 0) return null
  return Math.round((attained / quotaAmount) * 10000) / 100
}

export type QuotaTargetDoc = {
  brand: string
  userId: string
  period: string
  periodType: PeriodType
  amount: number
  currency: string
  setBy: string
  createdAt: Date
  updatedAt: Date
}

// Lazy/idempotent, same convention as lib/bulk-undo.ts's
// ensureBulkUndoIndexes — a failed createIndex call (e.g. transient network
// blip) must never block a quota read or write.
export async function ensureQuotaIndexes(db: Db): Promise<void> {
  try {
    await db.collection(QUOTA_COLLECTION).createIndex({ brand: 1, userId: 1, period: 1 }, { unique: true })
  } catch {
    // best-effort; see comment above
  }
}

export async function getQuotaTarget(db: Db, brand: string, userId: string, period: string): Promise<QuotaTargetDoc | null> {
  const doc = await db.collection(QUOTA_COLLECTION).findOne({ brand, userId, period })
  if (!doc) return null
  return {
    brand: doc.brand,
    userId: doc.userId,
    period: doc.period,
    periodType: doc.periodType,
    amount: doc.amount,
    currency: doc.currency,
    setBy: doc.setBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function setQuotaTarget(db: Db, input: {
  brand: string
  userId: string
  period: string
  periodType: PeriodType
  amount: number
  currency: string
  setBy: string
}): Promise<QuotaTargetDoc> {
  await ensureQuotaIndexes(db)
  const now = new Date()
  await db.collection(QUOTA_COLLECTION).updateOne(
    { brand: input.brand, userId: input.userId, period: input.period },
    {
      $set: {
        periodType: input.periodType,
        amount: input.amount,
        currency: input.currency,
        setBy: input.setBy,
        updatedAt: now,
      },
      $setOnInsert: { brand: input.brand, userId: input.userId, period: input.period, createdAt: now },
    },
    { upsert: true }
  )
  return (await getQuotaTarget(db, input.brand, input.userId, input.period))!
}
