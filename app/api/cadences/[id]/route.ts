import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { sanitizeCadenceSteps, validateCadence } from '../../../../lib/cadences'
import type { Cadence } from '../../../../lib/cadences'
import { getBrandConfig, resolveBrand } from '../../../lib/brand'
import type { Brand } from '../../../lib/brand'

export const dynamic = 'force-dynamic'

const COLLECTION = 'cadences'

// Same brand resolution as app/api/cadences/route.ts — the resolved slug is
// both the access-check scope and part of every lookup/write filter below.
async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  return await resolveBrand((url.searchParams.get('brand') || '').trim())
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

// Scoped by brand as well as tenant (issue #227): access is checked against
// the requested brand, so an id belonging to another brand in the same
// tenant must 404 rather than be readable/editable through this brand.
async function findCadence(db: any, id: string, tenantId: string, brand: Brand) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection(COLLECTION).findOne({ _id: objectId, brand, ...tenantFilter(tenantId) })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const doc = await findCadence(db, id, tenantId, brand)
    if (!doc) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(doc))
  } catch (error: any) {
    console.error('[API:cadences/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cadence' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findCadence(db, id, tenantId, brand)
    if (!existing) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const body = await request.json()

    // Partial update: only the provided top-level fields are validated and
    // written, defaulting to the existing value for anything omitted — same
    // "fields present in the request" contract PUT /api/battlecards/[id] uses.
    const merged = {
      name: body.name !== undefined ? String(body.name).trim().slice(0, 200) : existing.name,
      steps: body.steps !== undefined ? sanitizeCadenceSteps(body.steps) : (existing.steps || []),
    }

    const errors = validateCadence(merged)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (body.name !== undefined) updateData.name = merged.name
    if (body.steps !== undefined) updateData.steps = merged.steps
    if (body.enabled !== undefined) updateData.enabled = body.enabled === true

    const result = await db.collection(COLLECTION).findOneAndUpdate(
      { _id: existing._id, brand, ...tenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Cadence not found after update' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(result))
  } catch (error: any) {
    console.error('[API:cadences/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update cadence' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findCadence(db, id, tenantId, brand)
    if (!existing) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    // Issue #149's own edge case: block deleting a cadence template that
    // has leads actively enrolled on it, rather than silently leaving those
    // leads' activeCadence pointing at a deleted template with no error
    // path. The operator must cancel each lead's enrollment first.
    const config = await getBrandConfig(brand)
    if (config) {
      const leadsCollection = db.collection(config.dbCollection)
      // tenantFilter(), not a literal `{tenantId}` match — for the 'default'
      // tenant this also matches legacy leads with no tenantId field at all
      // (the same convention every lead lookup in this codebase uses), so a
      // legacy lead's enrollment isn't missed here while it's correctly
      // counted by the enroll/lookup paths above.
      const enrolledCount = await leadsCollection.countDocuments({
        ...tenantFilter(tenantId),
        'activeCadence.cadenceId': id,
      })
      if (enrolledCount > 0) {
        return NextResponse.json({
          error: `Cannot delete: ${enrolledCount} lead(s) are actively enrolled on this cadence. Cancel their enrollment first.`,
        }, { status: 409 })
      }
    }

    await db.collection(COLLECTION).deleteOne({ _id: existing._id, brand, ...tenantFilter(tenantId) })

    return NextResponse.json({ ok: true, id })
  } catch (error: any) {
    console.error('[API:cadences/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete cadence' }, { status: 500 })
  }
}
