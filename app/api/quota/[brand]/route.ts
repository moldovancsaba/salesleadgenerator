import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdminSession } from '@/lib/session'
import clientPromise, { isMongoConfigured } from '@/lib/mongodb'
import { getBrandConfig, resolveBrand } from '@/app/lib/brand'
import { getQuotaTarget, setQuotaTarget, isValidPeriod, PERIOD_TYPES } from '@/lib/quota'
import type { PeriodType } from '@/lib/quota'

// Quota tracking (issue #204) — target CRUD is super-admin-only, session-
// based, same gate as app/api/admin/teams/route.ts's own team CRUD: a
// quota is a human-curated admin concept, never touched by the research
// agent, so no x-api-key path.
export async function GET(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  const { brand: brandParam } = await params
  const brand = await resolveBrand(brandParam)
  const brandConfig = brand ? await getBrandConfig(brand) : null
  if (!brand || !brandConfig) {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  const period = searchParams.get('period')

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  const client = await clientPromise
  const db = client.db()

  if (userId && period) {
    const target = await getQuotaTarget(db, brand, userId, period)
    return NextResponse.json({ target })
  }

  const filter: Record<string, any> = { brand }
  if (userId) filter.userId = userId
  if (period) filter.period = period
  const docs = await db.collection('quota_targets').find(filter).toArray()
  const targets = docs.map((d: any) => ({
    brand: d.brand,
    userId: d.userId,
    period: d.period,
    periodType: d.periodType,
    amount: d.amount,
    currency: d.currency,
    setBy: d.setBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }))
  return NextResponse.json({ targets })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  const { brand: brandParam } = await params
  const brand = await resolveBrand(brandParam)
  const brandConfig = brand ? await getBrandConfig(brand) : null
  if (!brand || !brandConfig) {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const periodType: PeriodType = PERIOD_TYPES.includes(body.periodType) ? body.periodType : ('' as PeriodType)
  const period = typeof body.period === 'string' ? body.period : ''
  const amount = Number(body.amount)
  const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : brandConfig.currency

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (!PERIOD_TYPES.includes(periodType)) {
    return NextResponse.json({ error: 'periodType must be one of: ' + PERIOD_TYPES.join(', ') }, { status: 400 })
  }
  if (!isValidPeriod(period, periodType)) {
    return NextResponse.json({ error: `period is not a valid ${periodType} period (e.g. ${periodType === 'monthly' ? '2026-09' : periodType === 'quarterly' ? '2026-Q3' : '2026'})` }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 })
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  const client = await clientPromise
  const db = client.db()
  const target = await setQuotaTarget(db, { brand, userId, period, periodType, amount, currency, setBy: claimsOrResponse.sub })
  return NextResponse.json({ target })
}
