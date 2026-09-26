import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb'
import { requireApiKey } from '../../../../../lib/api-auth'
import { getBrandConfig, resolveBrand } from '../../../../lib/brand'
import { getTenantId, tenantFilter } from '../../../../../lib/tenant'
import { checkCountryConsistency, ANOMALY_REASONS, type CountryCheckReason } from '../../../../../lib/country-consistency'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS = 20

// Issue #222: counts how many of a brand's leads have a stored `country`
// that disagrees with their own address, scanning the whole brand inside the
// server so the caller never has to page through lead data. Read-only.
// Returns per-reason counts for every lead plus at most 20 compact rows for
// one reason at a time (?reason=, default the strongest evidence,
// 'mismatch'; ?offset= pages through that reason's rows). Rows carry only
// what a reviewer needs to fix `country` by hand, one lead at a time.
export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const url = new URL(request.url)
    const brand = await resolveBrand(url.searchParams.get('brand') || '')
    const config = brand ? await getBrandConfig(brand) : null
    if (!brand || !config || !url.searchParams.get('brand')) {
      return NextResponse.json({ error: 'A valid ?brand= is required' }, { status: 400 })
    }
    const reason = (url.searchParams.get('reason') || 'mismatch') as CountryCheckReason
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
    const limit = Math.min(MAX_ROWS, Math.max(1, parseInt(url.searchParams.get('limit') || String(MAX_ROWS), 10) || MAX_ROWS))
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const cursor = db.collection(config.dbCollection)
      .find(tenantFilter(tenantId), { projection: { _id: 1, entity_name: 1, country: 1, address: 1, region: 1 } })
      .sort({ _id: 1 })

    const counts: Partial<Record<CountryCheckReason, number>> = {}
    const rows: Array<Record<string, unknown>> = []
    let total = 0
    let seenForReason = 0
    for await (const lead of cursor) {
      total++
      const check = checkCountryConsistency({ country: lead.country, address: lead.address })
      counts[check.reason] = (counts[check.reason] || 0) + 1
      if (check.reason !== reason) continue
      if (seenForReason++ < offset || rows.length >= limit) continue
      rows.push({
        _id: String(lead._id),
        entity_name: lead.entity_name,
        country: lead.country ?? null,
        region: lead.region ?? null,
        evidence: check.evidence ?? null,
        suggestedCountry: check.evidenceCode ?? null,
      })
    }

    const anomalies = [...ANOMALY_REASONS].reduce((sum, r) => sum + (counts[r] || 0), 0)
    return NextResponse.json({
      brand,
      tenantId,
      total,
      anomalies,
      counts,
      reason,
      offset,
      rows,
      hasMore: seenForReason > offset + rows.length,
    })
  } catch (error: any) {
    console.error('[API:admin/data-hygiene/country] GET error:', error)
    return NextResponse.json({ error: 'Failed to run the country check' }, { status: 500 })
  }
}
