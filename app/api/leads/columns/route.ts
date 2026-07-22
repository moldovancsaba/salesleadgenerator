import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'

const CHUNK_SIZE = 50

function getTenantId(request: Request): string {
  return (new URL(request.url).searchParams.get('tenantId') || 'default').trim() || 'default'
}

function tenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId }
}

function resolveBrandFrom(request: Request): string {
  return resolveBrand(new URL(request.url).searchParams.get('brand') || 'cogmap')
}

export async function GET(request: Request) {
  try {
    const brand = resolveBrandFrom(request)
    const config = BRAND_CONFIG[brand]
    const tenantId = getTenantId(request)
    const filter = tenantFilter(tenantId)
    const { searchParams } = new URL(request.url)

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const column = searchParams.get('column')
    const allowed = new Set(['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'])
    if (!column || !allowed.has(column)) {
      return NextResponse.json({ error: 'column=DISCOVERED|QUALIFIED|ENGAGED|PROPOSAL|WON|LOST required' }, { status: 400 })
    }

    const cursor = searchParams.get('cursor')
    let cursorFilter: Record<string, any> = {}

    if (cursor) {
      const [sortOrderStr, id] = cursor.split('|')
      const sortOrder = parseFloat(sortOrderStr)

      const { ObjectId } = await import('mongodb')
      const idObj = ObjectId.isValid(id) ? new ObjectId(id) : undefined

      if (idObj) {
        cursorFilter = {
          $or: [
            { sortOrder: { $lt: sortOrder } },
            { sortOrder, _id: { $lt: idObj } },
          ],
        }
      } else if (!Number.isNaN(sortOrder)) {
        cursorFilter = { sortOrder: { $lt: sortOrder } }
      }
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)

    const colFilter = { kanbanColumn: column, ...filter }

    const [countDoc] = await collection.aggregate([
      { $match: colFilter },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]).toArray()
    const totalCount = typeof countDoc?.count === 'number' ? countDoc.count : 0

    const match = { $and: [colFilter, cursorFilter] }

    const rows = await collection.find(match)
      .sort({ sortOrder: -1, createdAt: -1 })
      .limit(CHUNK_SIZE)
      .toArray()

    const hasMore = rows.length >= CHUNK_SIZE
    const nextCursor = hasMore && rows.length > 0
      ? `${rows[rows.length - 1].sortOrder ?? 0}|${rows[rows.length - 1]._id.toString()}`
      : undefined

    const leads = rows.map((l: any) => ({
      ...l,
      _id: l._id.toString(),
      id: l.id ? Number(l.id) : undefined,
    }))

    return NextResponse.json({
      brand,
      tenantId,
      column,
      count: totalCount,
      leads,
      hasMore,
      nextCursor,
      fetchedAt: new Date().toISOString(),
      source: 'mongodb',
    })
  } catch (error: any) {
    console.error('[API:leads/columns] GET error:', error)
    return NextResponse.json({
      error: 'Failed to fetch column chunk',
      details: error.message,
    }, { status: 500 })
  }
}
