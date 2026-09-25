import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { resolveBrand, getAllBrandConfigs } from '../../../lib/brand'
import { backfillBuyingRoleCollection } from '../../../../lib/backfill-buying-role'

export const dynamic = 'force-dynamic'

// One-time (or ad hoc re-run) backfill trigger for issue #206 — x-api-key
// guarded, same pattern as POST /api/admin/ticket-size-backfill. Exists
// because the repo owner has no terminal/CLI access (mobile-only, per
// CLAUDE.md) and so cannot run a backfill script directly; this is the path
// they can actually trigger.
//
// Body: { brand?: 'cogmap'|'seyu'|'dvsc', apply?: boolean }
// Defaults to a dry run (apply: false) across every brand so a first call
// never writes by accident — pass apply: true explicitly to commit changes.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const apply = body.apply === true

    if (typeof body.brand === 'string' && !(await resolveBrand(body.brand))) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    }
    const allBrandConfigs = await getAllBrandConfigs()
    const brands = typeof body.brand === 'string'
      ? [(await resolveBrand(body.brand))!]
      : Object.keys(allBrandConfigs)

    const client = await clientPromise
    const db = client.db()

    const results: Record<string, unknown> = {}
    const totals = { scanned: 0, updated: 0, unchanged: 0, contactsUpdated: 0 }

    for (const brand of brands) {
      const config = allBrandConfigs[brand]
      const result = await backfillBuyingRoleCollection(db, config.dbCollection, { apply })
      results[brand] = {
        collection: config.dbCollection,
        scanned: result.scanned,
        updated: result.updated,
        unchanged: result.unchanged,
        contactsUpdated: result.contactsUpdated,
      }
      totals.scanned += result.scanned
      totals.updated += result.updated
      totals.unchanged += result.unchanged
      totals.contactsUpdated += result.contactsUpdated
    }

    return NextResponse.json({ apply, totals, byBrand: results })
  } catch (error: any) {
    console.error('[API:admin/buying-role-backfill] POST error:', error)
    return NextResponse.json({ error: 'Failed to backfill buying roles', details: error.message }, { status: 500 })
  }
}
