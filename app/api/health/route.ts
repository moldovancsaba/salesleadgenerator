import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { getAllBrandConfigs } from '../../lib/brand'
import { tenantFilter } from '../../../lib/tenant'
import { FORECAST_SNAPSHOT_COLLECTION } from '../../lib/forecast-snapshot'

function getTenantId(request: Request): string {
  const url = new URL(request.url);
  const tenantId = (url.searchParams.get('tenantId') || '').trim();
  return tenantId || '';
}

type ForecastSnapshotHealth = {
  capturedAt: string | null
  brands: Record<string, 'written' | 'stale' | 'never'>
}

// A snapshot older than 9 days (a week plus a cycle of slack for a delayed
// cron run) reads as 'stale' rather than 'never' — distinguishing "the job
// stopped running" from "it has genuinely never run for this brand."
const STALE_THRESHOLD_MS = 9 * 24 * 60 * 60 * 1000

async function computeLastForecastSnapshot(db: any, tenantId: string): Promise<ForecastSnapshotHealth> {
  const effectiveTenantId = tenantId || 'default'
  const now = Date.now()
  const brands: Record<string, 'written' | 'stale' | 'never'> = {}
  let latestCapturedAt: string | null = null

  for (const brandKey of Object.keys(await getAllBrandConfigs())) {
    try {
      const doc = await db.collection(FORECAST_SNAPSHOT_COLLECTION)
        .find({ brand: brandKey, tenantId: effectiveTenantId })
        .sort({ capturedAt: -1 })
        .limit(1)
        .next()

      if (!doc) {
        brands[brandKey] = 'never'
        continue
      }

      const capturedAt = doc.capturedAt instanceof Date ? doc.capturedAt.toISOString() : String(doc.capturedAt)
      if (!latestCapturedAt || new Date(capturedAt) > new Date(latestCapturedAt)) {
        latestCapturedAt = capturedAt
      }
      brands[brandKey] = (now - new Date(capturedAt).getTime()) > STALE_THRESHOLD_MS ? 'stale' : 'written'
    } catch {
      brands[brandKey] = 'never'
    }
  }

  return { capturedAt: latestCapturedAt, brands }
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
    if (!process.env.MONGODB_URI) {
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
    const db = client.db()
    database = db.databaseName || 'connected'

    // Measure DB latency with a lightweight ping
    const pingStarted = Date.now()
    await db.admin().ping()
    dbLatencyMs = Date.now() - pingStarted

    // Count leads by brand
    try {
      for (const [brandKey, config] of Object.entries(await getAllBrandConfigs())) {
        try {
          const count = await db.collection(config.dbCollection).countDocuments({})
          leadCounts[brandKey] = count
        } catch {
          leadCounts[brandKey] = -1
        }
      }

      if (tenantId) {
        const tenantCounts: Record<string, number> = {}
        for (const [brandKey, config] of Object.entries(await getAllBrandConfigs())) {
          try {
            const count = await db.collection(config.dbCollection).countDocuments(tenantFilter(tenantId))
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

    let lastForecastSnapshot: ForecastSnapshotHealth | null = null
    try {
      lastForecastSnapshot = await computeLastForecastSnapshot(db, tenantId)
    } catch {
      // Non-fatal: snapshot freshness is informational
    }

    status = dbLatencyMs > 2000 ? 'degraded' : 'ok'

    return NextResponse.json({
      status,
      database,
      dbLatencyMs,
      leadCounts,
      tenantId: tenantId || undefined,
      tenantLeadCounts,
      lastForecastSnapshot,
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
