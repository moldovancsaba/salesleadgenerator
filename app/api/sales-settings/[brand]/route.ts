import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { getTenantId } from '@/lib/tenant'
import { sanitizeSalesSettings, emptySalesSettings, defaultRevenueTargetCurrency } from '@/app/lib/sales-settings'
import { backfillTicketSizeCollection } from '@/lib/backfill-ticket-size'

const COLLECTION = 'company_settings'

export async function GET(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params
    const brand = resolveBrand(brandParam)
    const tenantId = getTenantId(request)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(COLLECTION)

    const doc = await collection.findOne({ brand, tenantId })

    if (!doc) {
      return NextResponse.json({ settings: emptySalesSettings(brand, tenantId), source: 'default' })
    }

    // Run stored docs through the same sanitizer PUT already applies on write
    // (issue #101): a doc saved before a schema field existed (e.g.
    // customerTypes, added after some brands' docs were first created) was
    // returned here completely unsanitized, so that field came back
    // `undefined` — the client's `settings.customerTypes.includes(...)`
    // (a required, non-optional array in the SalesSettings type) crashed
    // with no error boundary, taking down the whole page. Sanitizing here
    // guarantees GET and PUT can never disagree about what a complete,
    // safe SalesSettings object looks like.
    const { _id, updatedAt, ...rest } = doc as any
    const settings = { ...sanitizeSalesSettings(rest, brand, tenantId), updatedAt }
    return NextResponse.json({ settings, source: 'mongodb' })
  } catch (error: any) {
    console.error('[API:sales-settings/[brand]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch sales settings', details: error.message }, { status: 500 })
  }
}

// No requireApiKey guard here, deliberately: this route is meant to be written
// directly from the browser Save button (app/salessettings/[client]), which has
// no way to safely carry a server-side secret without a login system — the
// same reasoning /api/settings's PUT already follows for its own browser-edited
// document. Company settings are not lead/contact data, so the blast radius of
// an anonymous write is limited to a company's own sales-context text.
export async function PUT(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params
    const brand = resolveBrand(brandParam)
    const tenantId = getTenantId(request)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const body = await request.json()
    const sanitized = sanitizeSalesSettings(body, brand, tenantId)
    const updatedAt = new Date().toISOString()

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(COLLECTION)

    await collection.updateOne(
      { brand, tenantId },
      { $set: { ...sanitized, updatedAt } },
      { upsert: true }
    )

    // Fire-and-forget ticket-size recompute across this brand's leads
    // (issue #82) — an operator correcting a wrong dealSize.largestWon or
    // adding a product's per-unit pricing should not have to wait for the
    // weekly cron sweep (/api/admin/ticket-size-recalc) for every lead's
    // estimate to reflect it. Never awaited: a slow recompute over many
    // leads must never delay this save's response, same non-blocking
    // contract already established for issues #67/#69's background writes.
    const config = BRAND_CONFIG[brand]
    if (config) {
      void backfillTicketSizeCollection(db, config.dbCollection, brand, tenantId, defaultRevenueTargetCurrency(brand), { apply: true })
        .catch((error) => console.error('[sales-settings PUT] ticket-size recompute failed', { brand, tenantId, error }))
    }

    return NextResponse.json({ settings: { ...sanitized, updatedAt }, source: 'mongodb' })
  } catch (error: any) {
    console.error('[API:sales-settings/[brand]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to save sales settings', details: error.message }, { status: 500 })
  }
}
