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

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const brand = (searchParams.get('brand') || '').trim() || undefined
    const region = (searchParams.get('region') || '').trim() || undefined
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50') || 50))

    if (!q) {
      return NextResponse.json({ error: 'Missing search query', hint: 'Use ?q=<text>' }, { status: 400 })
    }

    const brands = brand ? ([brand] as Array<'cogmap' | 'seyu'>) : ['cogmap', 'seyu']
    const results: any[] = []

    for (const brandKey of brands) {
      if (!BRAND_CONFIG[brandKey]) continue
      const config = BRAND_CONFIG[brandKey]
      const client = await clientPromise
      const db = client.db()
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

      const rawLeads = await db.collection(config.dbCollection)
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()

      // Dedup by fingerprint (newest wins), matching /api/leads' GET handler —
      // the underlying collections can contain duplicate-fingerprint documents.
      const byFingerprint = new Map<string, any>()
      for (const lead of rawLeads) {
        const fp = lead.fingerprint || lead._id.toString()
        const existing = byFingerprint.get(fp)
        if (!existing || new Date(lead.createdAt) > new Date(existing.createdAt)) {
          byFingerprint.set(fp, lead)
        }
      }

      results.push(...Array.from(byFingerprint.values()).map((l) => ({ ...l, brand: brandKey })))
    }

    return NextResponse.json({
      query: q,
      total: results.length,
      results,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API:search] GET error:', error)
    return NextResponse.json({ error: 'Search failed', details: error.message }, { status: 500 })
  }
}
