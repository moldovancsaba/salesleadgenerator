import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey } from '../../../../lib/api-auth'
import { processWebhookDeliveries } from '../../../lib/webhook-store'

// Issue #210 sub-issue #219 — the outbound webhook delivery worker's one
// scheduled tick. Hourly cadence (vercel.json), same cron/manual-trigger
// auth split as app/api/admin/reports-tick/route.ts (GET for the real
// Vercel Cron trigger, which calls with a plain GET by default; POST for a
// manual/x-api-key-triggered run). See app/lib/webhook-store.ts's header
// comment for why hourly, not the issue's own every-minute suggestion.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const client = await clientPromise
    const summary = await processWebhookDeliveries(client.db())
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/webhook-delivery-tick] GET error:', error)
    return NextResponse.json({ error: 'Failed to run webhook delivery tick' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const client = await clientPromise
    const summary = await processWebhookDeliveries(client.db())
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/webhook-delivery-tick] POST error:', error)
    return NextResponse.json({ error: 'Failed to run webhook delivery tick' }, { status: 500 })
  }
}
