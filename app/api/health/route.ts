import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { BRAND_CONFIG } from '../../lib/brand'

export async function GET() {
  const started = Date.now()
  let database = 'unavailable'
  let dbLatencyMs: number | null = null
  let leadCounts: Record<string, number> = {}
  let status: 'ok' | 'degraded' | 'error' = 'error'
  let lastError: { timestamp?: string; message?: string } | null = null

  try {
    if (!clientPromise) {
      return NextResponse.json(
        {
          status: 'degraded',
          database,
          dbLatencyMs: null,
          leadCounts,
          lastError: { timestamp: new Date().toISOString(), message: 'Database client not configured' },
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      )
    }

    const client = await clientPromise
    const db = client.db()
    database = db.databaseName || 'connected'

    // Measure DB latency with a lightweight ping
    const pingStarted = Date.now()
    await db.admin().ping()
    dbLatencyMs = Date.now() - pingStarted

    // Count leads by brand
    try {
      for (const [brandKey, config] of Object.entries(BRAND_CONFIG)) {
        try {
          const count = await db.collection(config.dbCollection).countDocuments({})
          leadCounts[brandKey] = count
        } catch {
          leadCounts[brandKey] = -1
        }
      }
    } catch {
      // Non-fatal: counts are informational
    }

    status = dbLatencyMs > 2000 ? 'degraded' : 'ok'

    return NextResponse.json({
      status,
      database,
      dbLatencyMs,
      leadCounts,
      lastError,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    const elapsed = Date.now() - started
    return NextResponse.json(
      {
        status: 'error',
        database,
        dbLatencyMs: elapsed,
        leadCounts,
        lastError: {
          timestamp: new Date().toISOString(),
          message: error?.message || 'Unknown health check failure',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
