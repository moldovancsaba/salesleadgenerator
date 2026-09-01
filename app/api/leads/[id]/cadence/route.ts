import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../../lib/brand'
import type { Brand } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../../lib/tenant'
import { buildInitialActiveCadence } from '../../../../../lib/cadences'

export const dynamic = 'force-dynamic'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap'
  return await resolveBrand(brandParam)
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
    const brand = await getBrand(request)
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

    const config = (await getBrandConfig(brand))!
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

    // Scoped to this lead's own brand, not just tenant — a cadence id from a
    // different brand in the same tenant must never be enrollable (it would
    // expose the lead to the wrong brand's future messaging, and the
    // cadence-deletion guard below only checks each cadence's own brand's
    // lead collection, so a cross-brand enrollment would go unnoticed there
    // too).
    const cadenceDoc = await db.collection('cadences').findOne({ _id: cadenceObjectId, brand, ...tenantFilter(tenantId) })
    if (!cadenceDoc) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const activeCadence = buildInitialActiveCadence({ id: cadenceDoc._id.toString(), steps: cadenceDoc.steps || [] })
    if (!activeCadence) {
      return NextResponse.json({ error: 'Cadence has no steps' }, { status: 400 })
    }

    // The `lead.activeCadence` check above is a fast-path only — two
    // concurrent enroll requests for the same lead could both pass it before
    // either writes. The `activeCadence: null` clause in this filter makes
    // the actual write atomic: only one of two racing requests can match a
    // document still at `null`, so the loser gets a real 409 instead of
    // silently overwriting the winner's enrollment.
    const enrollResult = await db.collection(config.dbCollection).findOneAndUpdate(
      { _id: leadObjectId, ...tenantFilter(tenantId), activeCadence: null },
      { $set: { activeCadence, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!enrollResult) {
      return NextResponse.json({ error: 'Lead already has an active cadence enrollment' }, { status: 409 })
    }

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
    const brand = await getBrand(request)
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

    const config = (await getBrandConfig(brand))!
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
