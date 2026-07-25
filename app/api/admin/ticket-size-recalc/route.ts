import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey } from '../../../../lib/api-auth'
import { BRAND_CONFIG } from '../../../lib/brand'
import { defaultRevenueTargetCurrency } from '../../../lib/sales-settings'
import { backfillTicketSizeCollection } from '../../../../lib/backfill-ticket-size'

export const dynamic = 'force-dynamic'

const BRANDS = Object.keys(BRAND_CONFIG) as Array<keyof typeof BRAND_CONFIG>
const TENANT_ID = 'default'

async function recalcAllBrands() {
  const client = await clientPromise
  const db = client.db()

  const byBrand: Record<string, unknown> = {}
  const totals = { scanned: 0, updated: 0, unchanged: 0 }

  for (const brand of BRANDS) {
    const config = BRAND_CONFIG[brand]
    const currency = defaultRevenueTargetCurrency(brand)
    const result = await backfillTicketSizeCollection(db, config.dbCollection, brand, TENANT_ID, currency, { apply: true })
    byBrand[brand] = {
      collection: config.dbCollection,
      scanned: result.scanned,
      updated: result.updated,
      unchanged: result.unchanged,
      methodCounts: result.methodCounts,
    }
    totals.scanned += result.scanned
    totals.updated += result.updated
    totals.unchanged += result.unchanged
  }

  return { totals, byBrand }
}

// GET is the Vercel Cron target (automatic `Authorization: Bearer
// $CRON_SECRET`) but also accepts the standard x-api-key admin auth for a
// manual re-trigger — same pattern as GET /api/admin/forecast-snapshot.
// Reuses #81's backfillTicketSizeCollection() as the recalculation itself
// (always apply: true here, unlike #81's own dry-run-by-default admin
// endpoint) — a lead whose ticketSizeEstimate already matches what
// estimateTicketSize() derives today is a no-op write, so a weekly sweep
// over an unchanged company_settings costs nothing beyond the read.
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const result = await recalcAllBrands()
    return NextResponse.json({ recalculatedAt: new Date().toISOString(), ...result })
  } catch (error: any) {
    console.error('[API:admin/ticket-size-recalc] GET error:', error)
    return NextResponse.json({ error: 'Failed to recalculate ticket sizes', details: error.message }, { status: 500 })
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
    const result = await recalcAllBrands()
    return NextResponse.json({ recalculatedAt: new Date().toISOString(), ...result })
  } catch (error: any) {
    console.error('[API:admin/ticket-size-recalc] POST error:', error)
    return NextResponse.json({ error: 'Failed to recalculate ticket sizes', details: error.message }, { status: 500 })
  }
}
