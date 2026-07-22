import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { BRAND_CONFIG } from '../../../lib/brand'

export const dynamic = 'force-dynamic'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const targetBrand = brand === 'default' ? Object.keys(BRAND_CONFIG) : [brand]
    const tenantFilter = tenantId === 'default' ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] } : { tenantId }

    if (!isMongoConfigured()) {
      return NextResponse.json({ brands: targetBrand.map(b => ({ brand: b, total: 0, malformed: 0 })), source: 'default' })
    }

    const client = await clientPromise
    const db = client.db()
    const report = await Promise.all(
      Object.entries(BRAND_CONFIG).map(async ([brandKey, config]) => {
        const total = await db.collection(config.dbCollection).countDocuments(tenantFilter)

        const malformedWithProFor = await db.collection(config.dbCollection).countDocuments({
          ...tenantFilter,
          [config.proField]: { $type: 'object' },
        })

        const malformedWithConFor = await db.collection(config.dbCollection).countDocuments({
          ...tenantFilter,
          [config.conField]: { $type: 'object' },
        })

        const malformedIce = await db.collection(config.dbCollection).countDocuments({
          ...tenantFilter,
          'ice.impact': { $type: 'string' },
        })

        const malformed = malformedWithProFor + malformedWithConFor + malformedIce

        return {
          brand: brandKey,
          total,
          malformed,
          breakdown: {
            malformedWithProFor,
            malformedWithConFor,
            malformedIce,
          },
        }
      })
    )

    return NextResponse.json({ brands: report, source: 'mongodb' })
  } catch (error: any) {
    console.error('[API:admin/data-hygiene] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch hygiene report', details: error.message }, { status: 500 })
  }
}
