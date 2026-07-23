import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand'
import { isAutoManagedColumn, ICE_SCORE_AGGREGATION_EXPR } from '@/lib/kanban-column'

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

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(config.dbCollection)
    const colFilter = { kanbanColumn: column, ...filter }

    const [countDoc] = await collection.aggregate([
      { $match: colFilter },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]).toArray()
    const totalCount = typeof countDoc?.count === 'number' ? countDoc.count : 0

    const cursor = searchParams.get('cursor')
    // Discovered/Qualified are auto-managed and always sorted by computed ICE
    // score, high to low — there's no stored, denormalized sort field for them.
    // Every other column keeps the existing user-controlled sortOrder sort.
    const autoManaged = isAutoManagedColumn(column)

    let rows: any[]

    if (autoManaged) {
      let cursorMatch: Record<string, any> = {}
      if (cursor) {
        const [iceScoreStr, id] = cursor.split('|')
        const iceScore = parseFloat(iceScoreStr)
        const { ObjectId } = await import('mongodb')
        const idObj = ObjectId.isValid(id) ? new ObjectId(id) : undefined

        if (idObj && !Number.isNaN(iceScore)) {
          cursorMatch = {
            $or: [
              { _iceScore: { $lt: iceScore } },
              { _iceScore: iceScore, _id: { $lt: idObj } },
            ],
          }
        } else if (!Number.isNaN(iceScore)) {
          cursorMatch = { _iceScore: { $lt: iceScore } }
        }
      }

      const pipeline: any[] = [
        { $match: colFilter },
        { $addFields: { _iceScore: ICE_SCORE_AGGREGATION_EXPR } },
      ]
      if (Object.keys(cursorMatch).length > 0) {
        pipeline.push({ $match: cursorMatch })
      }
      pipeline.push({ $sort: { _iceScore: -1, _id: -1 } }, { $limit: CHUNK_SIZE })

      rows = await collection.aggregate(pipeline).toArray()
    } else {
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

      const match = { $and: [colFilter, cursorFilter] }

      rows = await collection.find(match)
        .sort({ sortOrder: -1, createdAt: -1 })
        .limit(CHUNK_SIZE)
        .toArray()
    }

    const hasMore = rows.length >= CHUNK_SIZE
    const lastRow = rows[rows.length - 1]
    const nextCursor = hasMore && lastRow
      ? autoManaged
        ? `${lastRow._iceScore ?? 0}|${lastRow._id.toString()}`
        : `${lastRow.sortOrder ?? 0}|${lastRow._id.toString()}`
      : undefined

    const leads = rows.map((l: any) => {
      const { _iceScore, ...lead } = l
      void _iceScore;
      return {
        ...lead,
        _id: lead._id.toString(),
        id: lead.id ? Number(lead.id) : undefined,
      }
    })

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
