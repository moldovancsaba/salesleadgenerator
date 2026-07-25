import { NextResponse } from 'next/server'
import clientPromise from '../../../../../lib/mongodb'
import { requireApiKey } from '../../../../../lib/api-auth'
import { FORECAST_SNAPSHOT_COLLECTION } from '../../../../lib/forecast-snapshot'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 52
const MAX_LIMIT = 200

// Read endpoint for a future trend-chart UI (explicitly deferred to a
// follow-up issue, issue #57). Sorted ascending (oldest first) so a chart
// can render the array directly without an extra reverse step.
export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const brand = (searchParams.get('brand') || '').trim()
    const tenantId = (searchParams.get('tenantId') || 'default').trim() || 'default'
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(searchParams.get('limit') || '', 10) || DEFAULT_LIMIT))

    if (!brand) {
      return NextResponse.json({ error: 'Missing brand', hint: 'Use ?brand=cogmap|seyu' }, { status: 400 })
    }

    const filter: Record<string, any> = { brand, tenantId }
    if (from || to) {
      filter.capturedAt = {}
      if (from) filter.capturedAt.$gte = new Date(from)
      if (to) filter.capturedAt.$lte = new Date(to)
    }

    const client = await clientPromise
    const db = client.db()

    const snapshots = await db.collection(FORECAST_SNAPSHOT_COLLECTION)
      .find(filter)
      .sort({ capturedAt: -1 })
      .limit(limit)
      .toArray()

    snapshots.reverse()

    return NextResponse.json({
      brand,
      tenantId,
      snapshots: snapshots.map((s) => ({ ...s, _id: s._id.toString() })),
      count: snapshots.length,
    })
  } catch (error: any) {
    console.error('[API:admin/forecast-snapshot/history] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch forecast snapshot history', details: error.message }, { status: 500 })
  }
}
