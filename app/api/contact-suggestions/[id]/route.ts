import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '../../../lib/brand'
import type { Brand } from '../../../lib/brand'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { CONTACT_SUGGESTIONS_COLLECTION } from '../../../../lib/contact-reply-matching'
import { dedupeContacts, deriveContactEmails, contactKey } from '../../../../lib/contacts'

function getBrand(request: Request): Brand | null {
  const url = new URL(request.url)
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap'
  return resolveBrand(brandParam)
}

// Issue #142 — PATCH /api/contact-suggestions/[id] { action: 'ACCEPT' | 'REJECT' }.
// ACCEPT applies the suggested fields via the exact same dedupeContacts()
// path every other contacts[] write already uses (issue #45's shared-logic
// precedent) — never a new, separate write mechanism. REJECT discards the
// suggestion with no trace in contacts[], per issue #142's own Handover
// Requirements ("no destructive writes — suggestions are additive and
// require explicit human accept").
export async function PATCH(
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
    const action = String(body.action || '').toUpperCase()
    if (action !== 'ACCEPT' && action !== 'REJECT') {
      return NextResponse.json({ error: 'action must be ACCEPT or REJECT' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    let suggestionId: ObjectId
    try {
      suggestionId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid suggestion id' }, { status: 400 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const suggestionsCollection = db.collection(CONTACT_SUGGESTIONS_COLLECTION)

    const suggestion = await suggestionsCollection.findOne({ _id: suggestionId, brand, tenantId })
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
    }
    if (suggestion.status !== 'pending') {
      return NextResponse.json({ error: `Suggestion already ${suggestion.status}` }, { status: 409 })
    }

    const now = new Date()

    if (action === 'REJECT') {
      await suggestionsCollection.updateOne(
        { _id: suggestionId },
        { $set: { status: 'rejected', resolvedAt: now } }
      )
      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    // ACCEPT: merge suggested fields into the matched contact, then write
    // via the same dedupeContacts({ verify: true }) path PUT /api/leads/[id]
    // uses — this is a genuine re-verification event (a human just
    // confirmed the suggestion is correct).
    const config = BRAND_CONFIG[brand]
    let leadObjectId: ObjectId
    try {
      leadObjectId = new ObjectId(suggestion.leadId)
    } catch {
      return NextResponse.json({ error: 'Suggestion references an invalid leadId' }, { status: 500 })
    }
    const lead = await db.collection(config.dbCollection).findOne({ _id: leadObjectId, ...tenantFilter(tenantId) })
    if (!lead) {
      return NextResponse.json({ error: 'Matched lead no longer exists' }, { status: 404 })
    }

    const existingContacts = dedupeContacts(lead.contacts || [])
    let found = false
    const mergedRaw = existingContacts.map((c) => {
      if (contactKey(c) !== suggestion.matchedContactKey) return c
      found = true
      return {
        ...c,
        name: suggestion.suggested?.name || c.name,
        title: suggestion.suggested?.title || c.title,
        phone: suggestion.suggested?.phone || c.phone,
      }
    })
    if (!found) {
      return NextResponse.json({ error: 'Matched contact no longer exists on the lead (may have been edited/removed since this suggestion was generated)' }, { status: 409 })
    }

    const updatedContacts = dedupeContacts(mergedRaw, { verify: true })
    const contactEmails = deriveContactEmails(updatedContacts)

    await db.collection(config.dbCollection).updateOne(
      { _id: leadObjectId },
      { $set: { contacts: updatedContacts, contactEmails, updatedAt: now } }
    )
    await suggestionsCollection.updateOne(
      { _id: suggestionId },
      { $set: { status: 'accepted', resolvedAt: now } }
    )

    return NextResponse.json({ ok: true, status: 'accepted' })
  } catch (error: any) {
    console.error('PATCH /api/contact-suggestions/[id] Error:', error)
    return NextResponse.json({ error: 'Failed to update contact suggestion', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
