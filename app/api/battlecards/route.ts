import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { DEFAULT_BATTLECARDS } from '../../lib/battlecards/default-battlecards'
import type { Battlecard } from '../../lib/battlecards/default-battlecards'
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../lib/battlecards/validate-battlecard'
import { buildTaggedContentFilter, normalizeTags } from '../../lib/search/tagged-content-filter'
import { getTenantId } from '../../../lib/tenant'
import { getForbiddenTermsFor, resolveBrand } from '../../lib/brand'
import type { Brand } from '../../lib/brand'

export const dynamic = 'force-dynamic'

const SEARCH_TEXT_FIELDS = ['competitorName', 'positioningSummary']

// Issue #227: every handler is guarded by requireBrandAccessApi (SSO session
// with access to this brand, a matching scoped key, or the legacy key) — not
// requireApiKey, because the Battlecards page calls POST/PUT/DELETE from the
// browser. ?brand= is required here: an empty value is rejected explicitly
// rather than letting resolveBrand('') default to 'cogmap'.
async function resolveBattlecardBrand(request: NextRequest): Promise<Brand | NextResponse> {
  const raw = (request.nextUrl.searchParams.get('brand') || '').trim()
  if (!raw) return NextResponse.json({ error: 'Missing brand' }, { status: 400 })
  const brand = await resolveBrand(raw)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  const authError = await requireBrandAccessApi(request, brand)
  if (authError) return authError
  return brand
}

function matchesFilters(
  b: { competitorName: string; tags?: string[] },
  opts: { tags?: string[]; competitor?: string }
): boolean {
  if (opts.competitor && b.competitorName.toLowerCase() !== opts.competitor.toLowerCase()) return false
  if (opts.tags && opts.tags.length > 0) {
    const cardTagsLower = (b.tags || []).map((tag) => tag.toLowerCase())
    const requestedLower = opts.tags.map((tag) => tag.toLowerCase())
    if (!requestedLower.some((tag) => cardTagsLower.includes(tag))) return false
  }
  return true
}

export async function GET(request: NextRequest) {
  try {
    const brand = await resolveBattlecardBrand(request)
    if (brand instanceof NextResponse) return brand
    const tenantId = getTenantId(request)
    const { searchParams } = new URL(request.url)
    const competitor = (searchParams.get('competitor') || '').trim()
    const tagsRaw = (searchParams.get('tags') || searchParams.get('tag') || '').trim()
    const tags = tagsRaw ? normalizeTags(tagsRaw.split(',')) : []

    if (!isMongoConfigured()) {
      const matched = DEFAULT_BATTLECARDS.filter((b: Battlecard) => matchesFilters(b, { tags, competitor }))
      return NextResponse.json({ battlecards: matched, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const filter = buildTaggedContentFilter({ tenantId, brand, tags, textFields: SEARCH_TEXT_FIELDS })
    const docs = await db.collection('battlecards').find(filter).sort({ competitorName: 1 }).toArray()

    const mapped: Battlecard[] = docs.map((d) => ({
      id: d._id.toString(),
      competitorName: d.competitorName,
      positioningSummary: d.positioningSummary,
      proofPoints: d.proofPoints || [],
      objections: d.objections || [],
      tags: d.tags || [],
    }))

    if (!mapped.length) {
      return NextResponse.json({ battlecards: [], source: 'mongodb', brand })
    }

    const filtered = mapped.filter((b) => matchesFilters(b, { competitor }))
    return NextResponse.json({ battlecards: filtered, source: 'mongodb', brand })
  } catch (error: any) {
    console.error('[API:battlecards] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch battlecards', details: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const brand = await resolveBattlecardBrand(request)
    if (brand instanceof NextResponse) return brand
    const tenantId = getTenantId(request)
    const body = await request.json()

    const forbiddenTerms = await getForbiddenTermsFor(brand)
    const errors = validateBattlecardPayload(body, brand, forbiddenTerms)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const battlecard = {
      tenantId,
      brand,
      competitorName: String(body.competitorName).trim(),
      positioningSummary: String(body.positioningSummary).trim(),
      proofPoints: normalizeProofPoints(body.proofPoints),
      objections: normalizeObjections(body.objections),
      tags: normalizeTags(body.tags),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await db.collection('battlecards').insertOne(battlecard)

    return NextResponse.json({
      id: result.insertedId.toString(),
      ...battlecard,
    }, { status: 201 })
  } catch (error: any) {
    console.error('[API:battlecards] POST error:', error)
    return NextResponse.json({ error: 'Failed to create battlecard', details: error.message }, { status: 500 })
  }
}
