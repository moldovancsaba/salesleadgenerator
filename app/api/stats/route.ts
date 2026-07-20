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
    const filter = tenantFilter(tenantId)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ brands: {}, total: 0, source: 'default' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const brands: Record<string, { total: number; byColumn: Record<string, number>; byRegion: Record<string, number> }> = {}
    let total = 0

    for (const [brandKey, config] of Object.entries(BRAND_CONFIG)) {
      const collection = db.collection(config.dbCollection)
      const brandTotal = await collection.countDocuments(filter)
      total += brandTotal

      const byColumn = await collection
        .aggregate([
          { $match: filter },
          { $group: { _id: '$kanbanColumn', count: { $sum: 1 } } },
        ])
        .toArray()

      const byRegion = await collection
        .aggregate([
          { $match: filter },
          { $group: { _id: '$region', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray()

      brands[brandKey] = {
        total: brandTotal,
        byColumn: byColumn.reduce((acc, item) => ({ ...acc, [item._id || 'UNKNOWN']: item.count }), {}),
        byRegion: byRegion.reduce((acc, item) => ({ ...acc, [item._id || 'UNKNOWN']: item.count }), {}),
      }
    }

    return NextResponse.json({
      total,
      brands,
      tenantId,
      source: 'mongodb',
      fetchedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API:stats] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch stats', details: error.message }, { status: 500 })
  }
}
