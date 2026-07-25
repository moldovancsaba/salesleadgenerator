import { NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { tenantFilter } from '../../../../lib/tenant'
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../../lib/battlecards/validate-battlecard'
import { normalizeTags } from '../../../lib/search/tagged-content-filter'

export const dynamic = 'force-dynamic'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

function toResponseShape(doc: any) {
  return {
    id: doc._id.toString(),
    competitorName: doc.competitorName,
    positioningSummary: doc.positioningSummary,
    proofPoints: doc.proofPoints || [],
    objections: doc.objections || [],
    tags: doc.tags || [],
  }
}

async function findBattlecard(db: any, id: string, tenantId: string) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection('battlecards').findOne({ _id: objectId, ...tenantFilter(tenantId) })
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
    const doc = await findBattlecard(db, id, tenantId)
    if (!doc) {
      return NextResponse.json({ error: 'Battlecard not found' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(doc))
  } catch (error: any) {
    console.error('[API:battlecards/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch battlecard', details: error.message }, { status: 500 })
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
    const brand = getBrand(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findBattlecard(db, id, tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Battlecard not found' }, { status: 404 })
    }

    const body = await request.json()

    // Partial update: only the provided top-level fields are validated and
    // written, defaulting to the existing value for anything omitted — same
    // "fields present in the request" contract PUT /api/leads/[id] uses.
    const merged = {
      competitorName: body.competitorName !== undefined ? body.competitorName : existing.competitorName,
      positioningSummary: body.positioningSummary !== undefined ? body.positioningSummary : existing.positioningSummary,
      proofPoints: body.proofPoints !== undefined ? body.proofPoints : existing.proofPoints,
      objections: body.objections !== undefined ? body.objections : existing.objections,
    }

    const errors = validateBattlecardPayload(merged, brand)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (body.competitorName !== undefined) updateData.competitorName = String(body.competitorName).trim()
    if (body.positioningSummary !== undefined) updateData.positioningSummary = String(body.positioningSummary).trim()
    if (body.proofPoints !== undefined) updateData.proofPoints = normalizeProofPoints(body.proofPoints)
    if (body.objections !== undefined) updateData.objections = normalizeObjections(body.objections)
    if (body.tags !== undefined) updateData.tags = normalizeTags(body.tags)

    const result = await db.collection('battlecards').findOneAndUpdate(
      { _id: existing._id, ...tenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Battlecard not found after update' }, { status: 404 })
    }

    return NextResponse.json(toResponseShape(result))
  } catch (error: any) {
    console.error('[API:battlecards/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update battlecard', details: error.message }, { status: 500 })
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
    const existing = await findBattlecard(db, id, tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Battlecard not found' }, { status: 404 })
    }

    await db.collection('battlecards').deleteOne({ _id: existing._id, ...tenantFilter(tenantId) })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    console.error('[API:battlecards/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete battlecard', details: error.message }, { status: 500 })
  }
}
