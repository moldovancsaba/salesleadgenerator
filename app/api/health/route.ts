import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { BRAND_CONFIG } from '../../lib/brand'

function getTenantId(request: Request): string {
  const url = new URL(request.url);
  const tenantId = (url.searchParams.get('tenantId') || '').trim();
  return tenantId || '';
}

export async function GET(request: Request) {
  const started = Date.now()
  let database = 'unavailable'
  let dbLatencyMs: number | null = null
  let leadCounts: Record<string, number> = {}
  let tenantLeadCounts: Record<string, number> | null = null
  let status: 'ok' | 'degraded' | 'error' = 'error'
  let lastError: { timestamp?: string; message?: string } | null = null
  const tenantId = getTenantId(request)

  try {
    if (!clientPromise) {
      return NextResponse.json(
        {
          status: 'degraded',
          database,
          dbLatencyMs: null,
          leadCounts,
          tenantId: tenantId || undefined,
          tenantLeadCounts,
          lastError: { timestamp: new Date().toISOString(), message: 'Database client not configured' },
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      )
    }

    const client = await clientPromise
    if (!client) {
      return NextResponse.json(
        {
          status: 'degraded',
          database,
          dbLatencyMs: null,
          leadCounts,
          tenantId: tenantId || undefined,
          tenantLeadCounts,
          lastError: { timestamp: new Date().toISOString(), message: 'Database client not configured' },
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      )
    }

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

      if (tenantId) {
        const tenantCounts: Record<string, number> = {}
        for (const [brandKey, config] of Object.entries(BRAND_CONFIG)) {
          try {
            const count = await db.collection(config.dbCollection).countDocuments({ tenantId })
            tenantCounts[brandKey] = count
          } catch {
            tenantCounts[brandKey] = -1
          }
        }
        tenantLeadCounts = tenantCounts
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
      tenantId: tenantId || undefined,
      tenantLeadCounts,
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
        tenantId: tenantId || undefined,
        tenantLeadCounts,
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
