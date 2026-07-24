import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { resolveBrand } from '@/app/lib/brand'
import { getTenantId } from '@/lib/tenant'
import { sanitizeSalesSettings, emptySalesSettings } from '@/app/lib/sales-settings'

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

    const { _id, ...settings } = doc as any
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

    return NextResponse.json({ settings: { ...sanitized, updatedAt }, source: 'mongodb' })
  } catch (error: any) {
    console.error('[API:sales-settings/[brand]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to save sales settings', details: error.message }, { status: 500 })
  }
}
