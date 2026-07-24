import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { resolveBrand } from '@/app/lib/brand'
import { requireApiKey } from '@/lib/api-auth'
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

export async function PUT(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  const authError = requireApiKey(request)
  if (authError) return authError

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
