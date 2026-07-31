import { NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { sanitizeCadenceSteps, validateCadence } from '../../../../lib/cadences'
import type { Cadence } from '../../../../lib/cadences'

export const dynamic = 'force-dynamic'

const COLLECTION = 'cadences'

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

async function findCadence(db: any, id: string, tenantId: string) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection(COLLECTION).findOne({ _id: objectId, ...tenantFilter(tenantId) })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const doc = await findCadence(db, id, tenantId)
    if (!doc) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(doc))
  } catch (error: any) {
    console.error('[API:cadences/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cadence', details: error.message }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findCadence(db, id, tenantId)
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
      { _id: existing._id, ...tenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Cadence not found after update' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(result))
  } catch (error: any) {
    console.error('[API:cadences/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update cadence', details: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findCadence(db, id, tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    // Issue #149's own edge case: block deleting a cadence template that
    // has leads actively enrolled on it, rather than silently leaving those
    // leads' activeCadence pointing at a deleted template with no error
    // path. The operator must cancel each lead's enrollment first.
    const config = (await import('../../../../app/lib/brand')).BRAND_CONFIG[existing.brand]
    if (config) {
      const leadsCollection = db.collection(config.dbCollection)
      const enrolledCount = await leadsCollection.countDocuments({
        tenantId,
        'activeCadence.cadenceId': id,
      })
      if (enrolledCount > 0) {
        return NextResponse.json({
          error: `Cannot delete: ${enrolledCount} lead(s) are actively enrolled on this cadence. Cancel their enrollment first.`,
        }, { status: 409 })
      }
    }

    await db.collection(COLLECTION).deleteOne({ _id: existing._id, ...tenantFilter(tenantId) })

    return NextResponse.json({ ok: true, id })
  } catch (error: any) {
    console.error('[API:cadences/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete cadence', details: error.message }, { status: 500 })
  }
}
