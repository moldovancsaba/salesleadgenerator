import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey } from '../../../../lib/api-auth'
import { getAllBrandConfigs } from '../../../lib/brand'
import { runStaleTickForBrand } from '../../../lib/automation-store'

export const dynamic = 'force-dynamic'

const TENANT_ID = 'default'
// Same 200-per-brand-per-tick cap convention as cadence-tick's own
// MAX_CADENCE_SENDS_PER_TICK — a lead past the cap is picked up on
// tomorrow's tick, never lost.
const MAX_AUTOMATION_SCAN_PER_TICK = 200

type TickSummary = {
  brandsScanned: number
  rulesEvaluated: number
  leadsScanned: number
  actionsApplied: number
}

async function runAutomationTick(): Promise<TickSummary> {
  const client = await clientPromise
  const db = client.db()
  const now = new Date()

  const summary: TickSummary = { brandsScanned: 0, rulesEvaluated: 0, leadsScanned: 0, actionsApplied: 0 }

  // Derived from BRAND_CONFIG, never a hardcoded brand list — issue #147's
  // own fix for the same class of bug, followed here.
  const allBrandConfigs = await getAllBrandConfigs()
  for (const brand of Object.keys(allBrandConfigs)) {
    const config = allBrandConfigs[brand]
    summary.brandsScanned++
    const result = await runStaleTickForBrand(db, brand, TENANT_ID, config.dbCollection, MAX_AUTOMATION_SCAN_PER_TICK, now)
    summary.rulesEvaluated += result.rulesEvaluated
    summary.leadsScanned += result.leadsScanned
    summary.actionsApplied += result.actionsApplied
  }

  return summary
}

// GET is the Vercel Cron target (automatic `Authorization: Bearer
// $CRON_SECRET`) but also accepts the standard x-api-key admin auth for a
// manual re-trigger — same pattern as cadence-tick and every other admin
// cron route in this app. Event-fired triggers (lead_created,
// lead_moved_to_column) are NOT evaluated here — those fire synchronously
// from their own real write points (POST /api/leads,
// app/lib/lead-actions.ts's executeLeadAction()); this tick only ever
// evaluates stale_no_activity rules.
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runAutomationTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/automation-tick] GET error:', error)
    return NextResponse.json({ error: 'Failed to run automation tick', details: error.message }, { status: 500 })
  }
}

// Manual trigger — key-guarded (x-api-key), identical behavior to GET's
// cron path, exposed separately so a manual re-run never needs to spoof a
// cron header.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runAutomationTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/automation-tick] POST error:', error)
    return NextResponse.json({ error: 'Failed to run automation tick', details: error.message }, { status: 500 })
  }
}
