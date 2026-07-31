import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '../../../../lib/brand'
import type { Brand } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../../lib/tenant'
import { buildInitialActiveCadence } from '../../../../../lib/cadences'

export const dynamic = 'force-dynamic'

function getBrand(request: Request): Brand | null {
  const url = new URL(request.url)
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap'
  return resolveBrand(brandParam)
}

function parseObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id.trim())
  } catch {
    return null
  }
}

// POST /api/leads/[id]/cadence — enroll a lead on a cadence template (issue
// #124/#149). Gated by requireBrandAccessApi, matching PATCH /api/leads's own
// dual-auth convention for lead-scoped actions (ACCEPT/DECLINE/PIN/etc.) —
// this is the same kind of browser-triggered lead action, not admin template
// management (which uses requireApiKey alone, see app/api/cadences/route.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const brand = getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)
    const body = await request.json()
    const cadenceId = typeof body.cadenceId === 'string' ? body.cadenceId.trim() : ''
    if (!cadenceId) {
      return NextResponse.json({ error: 'cadenceId is required' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const leadObjectId = parseObjectId(id)
    if (!leadObjectId) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
    }
    const cadenceObjectId = parseObjectId(cadenceId)
    if (!cadenceObjectId) {
      return NextResponse.json({ error: 'Invalid cadenceId' }, { status: 400 })
    }

    const config = BRAND_CONFIG[brand]
    const client = await getClientPromise()
    const db = client.db()

    const lead = await db.collection(config.dbCollection).findOne({ _id: leadObjectId, ...tenantFilter(tenantId) })
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // One active cadence per lead at a time (issue #149's own Non-Goals) — an
    // already-enrolled lead must be explicitly cancelled (DELETE) first,
    // never silently overwritten by a second enroll call.
    if (lead.activeCadence) {
      return NextResponse.json({ error: 'Lead already has an active cadence enrollment' }, { status: 409 })
    }

    const cadenceDoc = await db.collection('cadences').findOne({ _id: cadenceObjectId, ...tenantFilter(tenantId) })
    if (!cadenceDoc) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const activeCadence = buildInitialActiveCadence({ id: cadenceDoc._id.toString(), steps: cadenceDoc.steps || [] })
    if (!activeCadence) {
      return NextResponse.json({ error: 'Cadence has no steps' }, { status: 400 })
    }

    await db.collection(config.dbCollection).updateOne(
      { _id: leadObjectId, ...tenantFilter(tenantId) },
      { $set: { activeCadence, updatedAt: new Date() } }
    )

    return NextResponse.json({ ok: true, activeCadence })
  } catch (error: any) {
    console.error('POST /api/leads/[id]/cadence Error:', error)
    return NextResponse.json({ error: 'Failed to enroll lead in cadence', details: error.message }, { status: 500 })
  }
}

// DELETE /api/leads/[id]/cadence — cancel: clears Lead.activeCadence. A lead
// with no active cadence is treated as already-cancelled (200, not 404) —
// the caller's desired end state is achieved either way.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const brand = getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const leadObjectId = parseObjectId(id)
    if (!leadObjectId) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
    }

    const config = BRAND_CONFIG[brand]
    const client = await getClientPromise()
    const db = client.db()

    const result = await db.collection(config.dbCollection).findOneAndUpdate(
      { _id: leadObjectId, ...tenantFilter(tenantId) },
      { $set: { activeCadence: null, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('DELETE /api/leads/[id]/cadence Error:', error)
    return NextResponse.json({ error: 'Failed to cancel cadence enrollment', details: error.message }, { status: 500 })
  }
}
