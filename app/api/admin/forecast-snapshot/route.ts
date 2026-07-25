import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey, isCronRequest } from '../../../../lib/api-auth'
import { isoWeekKey } from '../../../../lib/iso-week'
import { discoverTenantIds, writeForecastSnapshot } from '../../../lib/forecast-snapshot'
import type { SnapshotSource, SnapshotWriteResult } from '../../../lib/forecast-snapshot'

export const dynamic = 'force-dynamic'

const BRANDS: Array<'cogmap' | 'seyu'> = ['cogmap', 'seyu']

// GET is the Vercel Cron target (automatic `Authorization: Bearer
// $CRON_SECRET`) but also accepts the standard x-api-key admin auth for a
// manual same-week re-trigger. Loops every brand x discovered-tenant pair;
// one pair's failure never aborts the others (Retries/Timeouts, issue #57).
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const client = await clientPromise
    const db = client.db()
    const periodKey = isoWeekKey(new Date())
    const source: SnapshotSource = isCronRequest(request) ? 'vercel-cron' : 'manual'

    const results: SnapshotWriteResult[] = []
    for (const brand of BRANDS) {
      const tenantIds = await discoverTenantIds(db, brand)
      for (const tenantId of tenantIds) {
        results.push(await writeForecastSnapshot(db, brand, tenantId, periodKey, source))
      }
    }

    const failures = results.filter((r) => r.status === 'failed')

    return NextResponse.json({
      capturedAt: new Date().toISOString(),
      periodKey,
      results,
      failures,
    })
  } catch (error: any) {
    console.error('[API:admin/forecast-snapshot] GET error:', error)
    return NextResponse.json({ error: 'Failed to write forecast snapshots', details: error.message }, { status: 500 })
  }
}

// Manual/backfill trigger — key-guarded (x-api-key), not cron-secret-only.
// An explicit `periodKey` in the body marks the write as a backfill (there
// is no way to reconstruct a true past pipeline state — a backfilled
// snapshot is computed from *current* data, tagged accordingly so trend
// consumers can distinguish it from a genuinely-contemporaneous capture).
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const requestedPeriodKey = typeof body.periodKey === 'string' ? body.periodKey.trim() : ''
    const periodKey = requestedPeriodKey || isoWeekKey(new Date())
    const source: SnapshotSource = requestedPeriodKey ? 'backfill' : 'manual'
    const requestedTenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''

    const client = await clientPromise
    const db = client.db()

    const results: SnapshotWriteResult[] = []
    for (const brand of BRANDS) {
      const tenantIds = requestedTenantId ? [requestedTenantId] : await discoverTenantIds(db, brand)
      for (const tenantId of tenantIds) {
        results.push(await writeForecastSnapshot(db, brand, tenantId, periodKey, source))
      }
    }

    const failures = results.filter((r) => r.status === 'failed')

    return NextResponse.json({
      capturedAt: new Date().toISOString(),
      periodKey,
      source,
      results,
      failures,
    })
  } catch (error: any) {
    console.error('[API:admin/forecast-snapshot] POST error:', error)
    return NextResponse.json({ error: 'Failed to write forecast snapshots', details: error.message }, { status: 500 })
  }
}
