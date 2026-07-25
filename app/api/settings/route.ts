import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { DEFAULT_STALE_THRESHOLDS } from '../../../lib/stale-deal'

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
    const [weightsDoc, thresholdsDoc] = await Promise.all([
      db.collection('settings').findOne({ key: 'pipeline_weights' }),
      db.collection('settings').findOne({ key: 'stale_thresholds' }),
    ])
    const weights = weightsDoc?.weights || DEFAULT_WEIGHTS
    const thresholds = thresholdsDoc?.thresholds || DEFAULT_STALE_THRESHOLDS
    return NextResponse.json({
      weights,
      thresholds,
      source: weightsDoc ? 'mongodb' : 'default',
      thresholdsSource: thresholdsDoc ? 'mongodb' : 'default',
    })
  } catch (error: any) {
    console.error('[API:settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings', details: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const weights = body.weights
    const thresholds = body.thresholds

    if (weights !== undefined && (typeof weights !== 'object' || weights === null)) {
      return NextResponse.json({ error: 'weights must be an object' }, { status: 400 })
    }
    if (thresholds !== undefined && (typeof thresholds !== 'object' || thresholds === null)) {
      return NextResponse.json({ error: 'thresholds must be an object' }, { status: 400 })
    }
    if (weights === undefined && thresholds === undefined) {
      return NextResponse.json({ error: 'weights or thresholds object required' }, { status: 400 })
    }

    const client = await clientPromise
    const db = client.db()
    const updates: Promise<unknown>[] = []
    if (weights !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'pipeline_weights' },
          { $set: { weights, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    if (thresholds !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'stale_thresholds' },
          { $set: { thresholds, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    await Promise.all(updates)

    return NextResponse.json({ ok: true, weights, thresholds })
  } catch (error: any) {
    console.error('[API:settings] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings', details: error.message }, { status: 500 })
  }
}
