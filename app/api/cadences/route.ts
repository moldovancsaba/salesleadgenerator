import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { getTenantId } from '../../../lib/tenant'
import { sanitizeCadence, validateCadence } from '../../../lib/cadences'
import type { Cadence } from '../../../lib/cadences'

export const dynamic = 'force-dynamic'

const COLLECTION = 'cadences'

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

function toResponseShape(doc: any): Cadence {
  return {
    id: doc._id.toString(),
    brand: doc.brand,
    tenantId: doc.tenantId,
    name: doc.name,
    steps: doc.steps || [],
    enabled: doc.enabled === true,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
  }
}

// GET is unauthenticated, matching GET /api/outreach-templates and GET
// /api/battlecards — read-only reference data, same trust level as every
// other per-brand template list this app already serves without a gate.
export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ cadences: [], total: 0, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const docs = await db.collection(COLLECTION).find({ tenantId, brand }).sort({ name: 1 }).toArray()

    return NextResponse.json({
      cadences: docs.map(toResponseShape),
      total: docs.length,
      source: 'mongodb',
      brand,
    })
  } catch (error: any) {
    console.error('[API:cadences] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cadences', details: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const body = await request.json()

    const cadence = sanitizeCadence(body, brand, tenantId)
    const errors = validateCadence(cadence)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const { id: _id, ...doc } = cadence
    const result = await db.collection(COLLECTION).insertOne({
      ...doc,
      createdAt: new Date(cadence.createdAt),
      updatedAt: new Date(cadence.updatedAt),
    })

    return NextResponse.json({
      ...cadence,
      id: result.insertedId.toString(),
    }, { status: 201 })
  } catch (error: any) {
    console.error('[API:cadences] POST error:', error)
    return NextResponse.json({ error: 'Failed to create cadence', details: error.message }, { status: 500 })
  }
}
