import { NextResponse, type NextRequest } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { BRAND_CONFIG } from '../../lib/brand'
import type { Brand } from '../../lib/brand'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { escapeRegExp } from '../../lib/search/tagged-content-filter'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { requireSuperAdminSession } from '../../../lib/session'

// Issue #106: q was interpolated into $regex unescaped — a query containing
// regex metacharacters (e.g. "(a+)+$") was evaluated as regex syntax rather
// than literal text, a ReDoS risk against Mongo's regex engine as well as a
// functional bug (a literal search for "." matched every document). Same
// escapeRegExp() already used by GET /api/leads and /api/leads/columns for
// their own regex-matched fields.
// $and, not `{ ...tenantFilter(tenantId), $or: [...] }` — tenantFilter()
// for the 'default' tenant (this app's only tenant in practice) itself
// returns an object whose own top-level key is $or (lib/tenant.ts). Spreading
// it into the same object literal as this function's own $or silently
// overwrote the tenant scoping entirely (plain JS object spread — the later
// key wins), so this route had no tenant isolation at all — a live,
// confirmed bug (found during a 2026-07-27 documentation audit, same root
// cause as app/api/leads/[id]/route.ts's tryFindLead() fix one commit
// earlier, which this route was not checked against at the time). Combining
// via $and preserves both filters regardless of what keys either contains —
// the same pattern already used correctly by app/api/leads/route.ts and
// app/api/leads/columns/route.ts.
function buildSearchFilter(q: string, tenantId: string, region?: string) {
  const safeQ = escapeRegExp(q)
  const textMatch = {
    $or: [
      { entity_name: { $regex: safeQ, $options: 'i' } },
      { url: { $regex: safeQ, $options: 'i' } },
      { value_proposition: { $regex: safeQ, $options: 'i' } },
      { industry: { $regex: safeQ, $options: 'i' } },
      { sport_or_sector: { $regex: safeQ, $options: 'i' } },
      { notes: { $regex: safeQ, $options: 'i' } },
    ],
  }
  const filter: any = { $and: [tenantFilter(tenantId), textMatch] }
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

export async function GET(request: NextRequest) {
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
      const config = BRAND_CONFIG[brand]
      if (!config) {
        return NextResponse.json({ error: `Unknown brand: ${brand}` }, { status: 400 })
      }

      // Issue #192 — this route had no auth at all; brand is a real
      // BRAND_CONFIG key at this point (checked above), so it satisfies
      // the Brand type requireBrandAccessApi expects.
      const authError = await requireBrandAccessApi(request, brand as Brand)
      if (authError) return authError

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

    // Issue #192 — the no-brand mode below aggregates every brand's leads
    // (incl. contact PII) into one response and has no real in-app caller
    // (the app's own search bar always passes `brand`, confirmed via grep)
    // — same cross-tenant risk class as the other super-admin-only routes,
    // so it gets the stricter guard rather than requireBrandAccessApi
    // (which has no "every brand at once" concept to check access against).
    const superAdminError = await requireSuperAdminSession(request)
    if (superAdminError instanceof NextResponse) return superAdminError

    // Issue #147 — derived from BRAND_CONFIG's own keys, not a hardcoded
    // 2-brand array, so a future brand is picked up automatically.
    const brands = Object.keys(BRAND_CONFIG)
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
