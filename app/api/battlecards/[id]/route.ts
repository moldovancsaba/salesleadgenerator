import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../../lib/battlecards/validate-battlecard'
import { normalizeTags } from '../../../lib/search/tagged-content-filter'
import { getForbiddenTermsFor, resolveBrand } from '../../../lib/brand'
import type { Brand } from '../../../lib/brand'

export const dynamic = 'force-dynamic'

// Issue #227: same required-?brand= + requireBrandAccessApi guard as
// app/api/battlecards/route.ts (route modules can't export helpers, so it's
// repeated here). Every lookup and write below is also filtered by the
// resolved brand, so another brand's card id reads as 404 and PUT's
// forbidden-terms check always runs against the card's own brand.
async function resolveBattlecardBrand(request: NextRequest): Promise<Brand | NextResponse> {
  const raw = (request.nextUrl.searchParams.get('brand') || '').trim()
  if (!raw) return NextResponse.json({ error: 'Missing brand' }, { status: 400 })
  const brand = await resolveBrand(raw)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  const authError = await requireBrandAccessApi(request, brand)
  if (authError) return authError
  return brand
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

async function findBattlecard(db: any, id: string, tenantId: string, brand: Brand) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection('battlecards').findOne({ _id: objectId, brand, ...tenantFilter(tenantId) })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await resolveBattlecardBrand(request)
    if (brand instanceof NextResponse) return brand
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const doc = await findBattlecard(db, id, tenantId, brand)
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await resolveBattlecardBrand(request)
    if (brand instanceof NextResponse) return brand
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findBattlecard(db, id, tenantId, brand)
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

    const forbiddenTerms = await getForbiddenTermsFor(brand)
    const errors = validateBattlecardPayload(merged, brand, forbiddenTerms)
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
      { _id: existing._id, brand, ...tenantFilter(tenantId) },
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await resolveBattlecardBrand(request)
    if (brand instanceof NextResponse) return brand
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findBattlecard(db, id, tenantId, brand)
    if (!existing) {
      return NextResponse.json({ error: 'Battlecard not found' }, { status: 404 })
    }

    await db.collection('battlecards').deleteOne({ _id: existing._id, brand, ...tenantFilter(tenantId) })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    console.error('[API:battlecards/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete battlecard', details: error.message }, { status: 500 })
  }
}
