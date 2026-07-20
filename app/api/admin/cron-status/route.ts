import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'

const COLLECTION = 'outcomelogs'
const LEAD_COLLECTION_PATTERN = (brand: string) => (brand === 'seyu' ? 'seyu_leads' : 'leads')

type CronStatus = {
  brand: string
  status: 'healthy' | 'degraded' | 'unknown'
  lastRun: string | null
  lastRunAction: string | null
  lastRunOutcome: string | null
  runsLast24h: number
  leadsCreatedLast24h: number
  errorsLast24h: number
  errorRate: number
  avgRunsPerHour: number
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function getTenantId(request: Request): string {
  const url = new URL(request.url);
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim();
  return tenantId || 'default';
}

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  const tenantId = getTenantId(request)

  try {
    const client = await clientPromise
    const db = client.db()
    const since24h = hoursAgo(24)
    const since168h = hoursAgo(168) // 7 days

    // Tenant-isolated outcome log fetch
    const [logs24h, logs168h] = await Promise.all([
      db.collection(COLLECTION).find({ createdAt: { $gte: since24h }, tenantId }).sort({ createdAt: -1 }).limit(500).toArray(),
      db.collection(COLLECTION).find({ createdAt: { $gte: since168h }, tenantId }).sort({ createdAt: -1 }).limit(2000).toArray(),
    ])

    const byBrand24h = new Map<string, any[]>()
    const byBrand168h = new Map<string, any[]>()

    for (const log of logs24h) {
      const brand = log.brand || 'cogmap'
      if (!byBrand24h.has(brand)) byBrand24h.set(brand, [])
      byBrand24h.get(brand)!.push(log)
    }

    for (const log of logs168h) {
      const brand = log.brand || 'cogmap'
      if (!byBrand168h.has(brand)) byBrand168h.set(brand, [])
      byBrand168h.get(brand)!.push(log)
    }

    const statuses: CronStatus[] = []

    for (const brand of ['cogmap', 'seyu'] as const) {
      const logs24 = byBrand24h.get(brand) || []
      const logs168 = byBrand168h.get(brand) || []

      const lastRun = logs24[0] || null
      const lastRunAction = lastRun?.action || null
      const lastRunOutcome = lastRun?.outcomeType || lastRun?.outcomeValue || null

      const runsLast24h = logs24.length
      const errorsLast24h = logs24.filter((l: any) => {
        const outcome = String(l.outcomeType || l.outcomeValue || '').toUpperCase()
        return outcome.includes('ERROR') || outcome.includes('FAIL') || outcome.includes('TIMEOUT')
      }).length

      const leadsCreatedLast24h = logs24.filter((l: any) => {
        const action = String(l.action || '').toUpperCase()
        const outcome = String(l.outcomeType || '').toUpperCase()
        return action === 'CREATE' || outcome === 'CREATE'
      }).length

      const hoursWithActivity = new Set(logs168.map((l: any) => {
        const d = new Date(l.createdAt)
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      }).filter(Boolean)).size

      const avgRunsPerHour = hoursWithActivity > 0 ? logs168.length / hoursWithActivity : 0
      const errorRate = runsLast24h > 0 ? errorsLast24h / runsLast24h : 0

      let status: CronStatus['status'] = 'healthy'
      if (runsLast24h === 0 && hoursWithActivity > 0) {
        status = 'degraded'
      } else if (errorRate > 0.2) {
        status = 'degraded'
      } else if (runsLast24h === 0 && hoursWithActivity === 0) {
        status = 'unknown'
      }

      statuses.push({
        brand,
        status,
        lastRun: lastRun?.createdAt || null,
        lastRunAction,
        lastRunOutcome,
        runsLast24h,
        leadsCreatedLast24h,
        errorsLast24h,
        errorRate: Math.round(errorRate * 100) / 100,
        avgRunsPerHour: Math.round(avgRunsPerHour * 100) / 100,
      })
    }

    const overallStatus = statuses.every(s => s.status === 'healthy')
      ? 'healthy'
      : statuses.some(s => s.status === 'degraded')
        ? 'degraded'
        : 'unknown'

    return NextResponse.json({
      status: overallStatus,
      checkedAt: new Date().toISOString(),
      window: '24h',
      tenantId,
      brands: statuses,
    })
  } catch (error: any) {
    console.error('[API:admin/cron-status] GET error:', error)
    return NextResponse.json(
      {
        status: 'error',
        checkedAt: new Date().toISOString(),
        error: error?.message || 'Unknown failure',
      },
      { status: 500 }
    )
  }
}
