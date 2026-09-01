import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { resolveBrand, getAllBrandConfigs } from '../../../lib/brand'
import { defaultRevenueTargetCurrency } from '../../../lib/sales-settings'
import type { SalesSettings } from '../../../lib/sales-settings'
import { backfillTicketSizeCollection } from '../../../../lib/backfill-ticket-size'

export const dynamic = 'force-dynamic'

// One-time (or ad hoc re-run) backfill trigger for issue #81 — x-api-key
// guarded, same pattern as POST /api/win-rates/recalculate. Exists because
// the repo owner has no terminal/CLI access (mobile-only, per CLAUDE.md) and
// so cannot run scripts/backfill-ticket-size.ts directly; this is the path
// they can actually trigger, e.g. via a Claude Code session issuing the
// request with the configured SLG_API_KEY.
//
// Body: { brand?: 'cogmap'|'seyu', tenantId?: string, apply?: boolean }
// Defaults to a dry run (apply: false) across both brands so a first call
// never writes by accident — pass apply: true explicitly to commit changes.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const tenantId = (typeof body.tenantId === 'string' ? body.tenantId.trim() : '') || 'default'
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
    const totals = { scanned: 0, updated: 0, unchanged: 0 }

    for (const brand of brands) {
      const config = allBrandConfigs[brand]
      // Issue #169 — read the operator's actual saved currency choice
      // (settings.revenueTarget.currency) instead of always recomputing the
      // brand's fixed default; otherwise this admin sweep would silently
      // fight any non-default currency selected in Sales Settings.
      const settingsDoc = (await db.collection('company_settings').findOne({ brand, tenantId })) as SalesSettings | null
      const currency = settingsDoc?.revenueTarget?.currency ?? defaultRevenueTargetCurrency(config?.currency)
      const result = await backfillTicketSizeCollection(db, config.dbCollection, brand, tenantId, currency, { apply })
      results[brand] = {
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

    return NextResponse.json({ apply, tenantId, totals, byBrand: results })
  } catch (error: any) {
    console.error('[API:admin/ticket-size-backfill] POST error:', error)
    return NextResponse.json({ error: 'Failed to backfill ticket sizes', details: error.message }, { status: 500 })
  }
}
