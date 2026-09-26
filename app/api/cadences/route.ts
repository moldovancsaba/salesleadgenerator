import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { sanitizeCadence, validateCadence } from '../../../lib/cadences'
import type { Cadence } from '../../../lib/cadences'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import type { Brand } from '../../lib/brand'

export const dynamic = 'force-dynamic'

const COLLECTION = 'cadences'

// Resolved through the brand registry (aliases, case) rather than stored
// verbatim — an unknown brand is a 400, never a silently-created new scope.
async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  return await resolveBrand((url.searchParams.get('brand') || '').trim())
}

function toResponseShape(doc: any): Cadence {
  return {
    id: doc._id.toString(),
    brand: doc.brand,
    tenantId: doc.tenantId,
    name: doc.name,
    steps: doc.steps || [],
    enabled: doc.enabled === true,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
  }
}

// Every handler here (issue #227) is gated by requireBrandAccessApi — a
// valid x-api-key, a scoped key for this brand, or an SSO session with
// access to this brand — the same dual-auth app/api/leads/[id]/cadence
// uses. The list is per-brand sales playbook data with live enrolled-lead
// counts, not public reference data, so GET is gated like the writes.
export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ cadences: [], total: 0, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const docs = await db.collection(COLLECTION).find({ tenantId, brand }).sort({ name: 1 }).toArray()

    // Issue #152's own Architecture: the builder's list view shows a
    // leads-currently-enrolled count per cadence, so an operator can see
    // real impact before editing/disabling one — same countDocuments query
    // DELETE /api/cadences/[id]'s own safety check already uses.
    const config = await getBrandConfig(brand)
    const cadences = await Promise.all(docs.map(async (doc) => {
      const shape = toResponseShape(doc)
      const enrolledCount = config
        ? await db.collection(config.dbCollection).countDocuments({
            ...tenantFilter(tenantId),
            'activeCadence.cadenceId': shape.id,
          })
        : 0
      return { ...shape, enrolledCount }
    }))

    return NextResponse.json({
      cadences,
      total: cadences.length,
      source: 'mongodb',
      brand,
    })
  } catch (error: any) {
    console.error('[API:cadences] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cadences' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)
    const body = await request.json()

    const cadence = sanitizeCadence(body, brand, tenantId)
    const errors = validateCadence(cadence)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const { id: _id, ...doc } = cadence
    const result = await db.collection(COLLECTION).insertOne({
      ...doc,
      createdAt: new Date(cadence.createdAt),
      updatedAt: new Date(cadence.updatedAt),
    })

    return NextResponse.json({
      ...cadence,
      id: result.insertedId.toString(),
    }, { status: 201 })
  } catch (error: any) {
    console.error('[API:cadences] POST error:', error)
    return NextResponse.json({ error: 'Failed to create cadence' }, { status: 500 })
  }
}
