import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'

export const dynamic = 'force-dynamic'

const DEFAULT_WEIGHTS: Record<string, number> = {
  DISCOVERED: 0.01,
  QUALIFIED: 0.05,
  ENGAGED: 0.10,
  PROPOSAL: 0.25,
  WON: 1.0,
  LOST: 0.0,
}

export async function GET() {
  try {
    const client = await clientPromise
    const db = client.db()
    const doc = await db.collection('settings').findOne({ key: 'pipeline_weights' })
    const weights = doc?.weights || DEFAULT_WEIGHTS
    return NextResponse.json({ weights, source: doc ? 'mongodb' : 'default' })
  } catch (error: any) {
    console.error('[API:settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings', details: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const weights = body.weights
    if (!weights || typeof weights !== 'object') {
      return NextResponse.json({ error: 'weights object required' }, { status: 400 })
    }

    const client = await clientPromise
    const db = client.db()
    await db.collection('settings').updateOne(
      { key: 'pipeline_weights' },
      { $set: { weights, updatedAt: new Date() } },
      { upsert: true }
    )

    return NextResponse.json({ ok: true, weights })
  } catch (error: any) {
    console.error('[API:settings] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings', details: error.message }, { status: 500 })
  }
}
