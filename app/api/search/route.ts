import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { BRAND_CONFIG } from '../../lib/brand'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function tenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId }
}

function buildSearchFilter(q: string, tenantId: string, region?: string) {
  const filter: any = {
    ...tenantFilter(tenantId),
    $or: [
      { entity_name: { $regex: q, $options: 'i' } },
      { url: { $regex: q, $options: 'i' } },
      { value_proposition: { $regex: q, $options: 'i' } },
      { industry: { $regex: q, $options: 'i' } },
      { sport_or_sector: { $regex: q, $options: 'i' } },
      { notes: { $regex: q, $options: 'i' } },
    ],
  }
  if (region) filter.region = region
  return filter
}

// Dedup by fingerprint (newest wins), matching /api/leads' GET handler —
// the underlying collections can contain duplicate-fingerprint documents.
function dedupeByFingerprint(rawLeads: any[]) {
  const byFingerprint = new Map<string, any>()
  for (const lead of rawLeads) {
    const fp = lead.fingerprint || lead._id.toString()
    const existing = byFingerprint.get(fp)
    if (!existing || new Date(lead.createdAt) > new Date(existing.createdAt)) {
      byFingerprint.set(fp, lead)
    }
  }
  return Array.from(byFingerprint.values())
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const brand = (searchParams.get('brand') || '').trim() || undefined
    const region = (searchParams.get('region') || '').trim() || undefined
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50') || 50))
    const cursor = searchParams.get('cursor') || undefined

    if (!q) {
      return NextResponse.json({ error: 'Missing search query', hint: 'Use ?q=<text>' }, { status: 400 })
    }

    const client = await clientPromise
    const db = client.db()

    // Cursor pagination (the same shape /api/leads and /api/leads/columns
    // use) is only well-defined against a single collection. When a
    // specific brand is requested, use it (createdAt desc, _id desc as
    // tie-break). When searching across every brand at once, results come
    // from independently-sorted collections merged together — there's no
    // single resumable cursor position across them, so that mode stays a
    // flat capped list (hasMore always false, nextCursor always undefined),
    // which is an honest reflection of what it actually does rather than a
    // fake cursor that can't be resumed correctly.
    if (brand) {
      const config = BRAND_CONFIG[brand as 'cogmap' | 'seyu']
      if (!config) {
        return NextResponse.json({ error: `Unknown brand: ${brand}` }, { status: 400 })
      }

      const filter = buildSearchFilter(q, tenantId, region)
      const count = await db.collection(config.dbCollection).countDocuments(filter)

      let cursorFilter: Record<string, any> = {}
      if (cursor) {
        const [createdAtStr, id] = cursor.split('|')
        const createdAtMs = Number(createdAtStr)
        const { ObjectId } = await import('mongodb')
        const idObj = ObjectId.isValid(id) ? new ObjectId(id) : undefined
        if (Number.isFinite(createdAtMs) && idObj) {
          cursorFilter = {
            $or: [
              { createdAt: { $lt: new Date(createdAtMs) } },
              { createdAt: new Date(createdAtMs), _id: { $lt: idObj } },
            ],
          }
        }
      }

      const rawLeads = await db.collection(config.dbCollection)
        .find({ $and: [filter, cursorFilter] })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray()

      const hasMore = rawLeads.length >= limit
      const last = rawLeads[rawLeads.length - 1]
      const nextCursor = hasMore && last ? `${new Date(last.createdAt).getTime()}|${last._id.toString()}` : undefined

      const leads = dedupeByFingerprint(rawLeads).map((l) => ({ ...l, _id: l._id.toString(), brand }))

      return NextResponse.json({
        query: q,
        count,
        leads,
        hasMore,
        nextCursor,
        fetchedAt: new Date().toISOString(),
      })
    }

    const brands: Array<'cogmap' | 'seyu'> = ['cogmap', 'seyu']
    const leads: any[] = []
    let count = 0

    for (const brandKey of brands) {
      if (!BRAND_CONFIG[brandKey]) continue
      const config = BRAND_CONFIG[brandKey]
      const filter = buildSearchFilter(q, tenantId, region)
      count += await db.collection(config.dbCollection).countDocuments(filter)

      const rawLeads = await db.collection(config.dbCollection)
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()

      leads.push(...dedupeByFingerprint(rawLeads).map((l) => ({ ...l, _id: l._id.toString(), brand: brandKey })))
    }

    return NextResponse.json({
      query: q,
      count,
      leads,
      hasMore: false,
      nextCursor: undefined,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API:search] GET error:', error)
    return NextResponse.json({ error: 'Search failed', details: error.message }, { status: 500 })
  }
}
