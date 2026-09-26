import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { resolveBrand, getAllBrandConfigs } from '../../../lib/brand'
import { defaultRevenueTargetCurrency } from '../../../lib/sales-settings'
import type { SalesSettings } from '../../../lib/sales-settings'
import { backfillProductsForBrand } from '../../../../lib/backfill-products'

export const dynamic = 'force-dynamic'

// One-time (or ad hoc re-run) backfill trigger for issue #215 — x-api-key
// guarded, identical shape to POST /api/admin/ticket-size-backfill. Exists
// because the repo owner has no terminal/CLI access (mobile-only, per
// CLAUDE.md) and so cannot run scripts/backfill-products.ts directly.
//
// Body: { brand?: string, tenantId?: string, apply?: boolean }
// Defaults to a dry run (apply: false) across every brand so a first call
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
    const totals = { scanned: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 }

    for (const brand of brands) {
      const config = allBrandConfigs[brand]
      const settingsDoc = (await db.collection('company_settings').findOne({ brand, tenantId })) as SalesSettings | null
      const currency = settingsDoc?.revenueTarget?.currency ?? defaultRevenueTargetCurrency(config?.currency)
      const result = await backfillProductsForBrand(db, brand, tenantId, currency, { apply })
      results[brand] = {
        scanned: result.scanned,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
      }
      totals.scanned += result.scanned
      totals.created += result.created
      totals.updated += result.updated
      totals.unchanged += result.unchanged
      totals.skipped += result.skipped
    }

    return NextResponse.json({ apply, tenantId, totals, byBrand: results })
  } catch (error: any) {
    console.error('[API:admin/products-backfill] POST error:', error)
    return NextResponse.json({ error: 'Failed to backfill products' }, { status: 500 })
  }
}
