import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { resolveBrand } from '../../lib/brand'
import type { Brand } from '../../lib/brand'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId } from '../../../lib/tenant'
import { CONTACT_SUGGESTIONS_COLLECTION, ensureContactSuggestionsIndexes } from '../../../lib/contact-reply-matching'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap'
  return resolveBrand(brandParam)
}

// Issue #142 — GET /api/contact-suggestions?leadId=&brand=&status=: lists
// pending (default) or all contact-enrichment suggestions for review.
// Filtering by leadId is optional — omitted, this returns every pending
// suggestion for the brand/tenant (a future "review queue" list view could
// use that; the per-lead Activity tab passes leadId).
export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('leadId') || undefined
    const status = searchParams.get('status') || 'pending'

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    await ensureContactSuggestionsIndexes(db)

    const filter: Record<string, unknown> = { brand, tenantId }
    if (leadId) filter.leadId = leadId
    if (status !== 'all') filter.status = status

    const docs = await db
      .collection(CONTACT_SUGGESTIONS_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()

    const suggestions = docs.map((d: any) => ({
      id: d._id.toString(),
      leadId: d.leadId,
      matchedContactKey: d.matchedContactKey,
      current: d.current || {},
      suggested: d.suggested || {},
      status: d.status,
      createdAt: (d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt)).toISOString(),
      resolvedAt: d.resolvedAt ? (d.resolvedAt instanceof Date ? d.resolvedAt : new Date(d.resolvedAt)).toISOString() : undefined,
    }))

    return NextResponse.json({ suggestions, brand, tenantId, returned: suggestions.length })
  } catch (error: any) {
    console.error('GET /api/contact-suggestions Error:', error)
    return NextResponse.json({ error: 'Failed to fetch contact suggestions', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
