import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { evaluateOutreachRouting } from '../../lib/outreach/routing-rules'
import { getTenantId } from '../../../lib/tenant'
import { resolveBrand } from '../../lib/brand'

export const dynamic = 'force-dynamic'

// Issue #226: GET had no guard and returned outreach subjects and bodies.
// Key-only: no in-repo caller reads this route (the lead Activity tab reads
// outreach_logs through the brand-gated GET /api/leads/[id]/activity). POST
// is browser-called and uses requireBrandAccessApi (issue #227).
export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

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
    return NextResponse.json({ error: 'Failed to fetch outreach logs' }, { status: 500 })
  }
}

// Issue #227: brand-gated (requireBrandAccessApi) rather than key-only, so
// the compose modal's "Log outreach" works from a signed-in session. Brand
// comes from ?brand= first, then body.brand, and is stored as the resolved
// slug.
export async function POST(request: NextRequest) {
  try {
    const tenantId = getTenantId(request)
    const body = await request.json().catch(() => ({} as Record<string, any>))

    const brand = await resolveBrand(new URL(request.url).searchParams.get('brand') || body.brand)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const leadId = String(body.leadId || '').trim()
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
    return NextResponse.json({ error: 'Failed to create outreach log' }, { status: 500 })
  }
}
