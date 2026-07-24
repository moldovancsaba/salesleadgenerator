import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { evaluateOutreachRouting } from '../../lib/outreach/routing-rules'

export const dynamic = 'force-dynamic'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    if (!isMongoConfigured()) {
      return NextResponse.json({ logs: [], source: 'default' })
    }

    const client = await clientPromise
    const db = client.db()
    const logs = await db.collection('outreach_logs')
      .find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log._id.toString(),
        leadId: log.leadId,
        brand: log.brand,
        templateId: log.templateId,
        channel: log.channel,
        subject: log.subject,
        body: log.body,
        createdAt: log.createdAt,
        tenantId: log.tenantId,
        routingAllowed: log.routingAllowed,
        routingReason: log.routingReason,
      })),
      source: 'mongodb',
    })
  } catch (error: any) {
    console.error('[API:outreach-logs] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch outreach logs', details: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const body = await request.json()

    const leadId = String(body.leadId || '').trim()
    const brand = String(body.brand || 'default').trim()
    const channel = String(body.channel || '').trim() as 'email' | 'linkedin'
    const templateId = body.templateId ? String(body.templateId) : undefined
    const subject = body.subject ? String(body.subject) : undefined
    const bodyText = String(body.body || '').trim()

    if (!leadId || !channel || !bodyText) {
      return NextResponse.json({ error: 'leadId, channel, and body are required' }, { status: 400 })
    }

    if (!['email', 'linkedin'].includes(channel)) {
      return NextResponse.json({ error: 'channel must be email or linkedin' }, { status: 400 })
    }

    const routing = evaluateOutreachRouting(channel, {
      contacts: Array.isArray(body.contacts) ? body.contacts : [],
      url: body.url,
      industry: body.industry,
      sport_or_sector: body.sport_or_sector,
    }, bodyText)

    if (!routing.allowed) {
      return NextResponse.json({ error: routing.reason || 'Outreach not allowed for this channel/lead state.' }, { status: 400 })
    }

    if (channel === 'email' && !subject) {
      return NextResponse.json({ error: 'subject is required for email outreach' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const log = {
      tenantId,
      leadId,
      brand,
      templateId,
      channel,
      subject,
      body: bodyText,
      routingAllowed: routing.allowed,
      routingReason: routing.reason || null,
      createdAt: new Date(),
    }

    const result = await db.collection('outreach_logs').insertOne(log)

    return NextResponse.json({ id: result.insertedId.toString(), ...log }, { status: 201 })
  } catch (error: any) {
    console.error('[API:outreach-logs] POST error:', error)
    return NextResponse.json({ error: 'Failed to create outreach log', details: error.message }, { status: 500 })
  }
}
