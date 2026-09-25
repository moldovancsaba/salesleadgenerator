import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { getTenantId } from '../../../lib/tenant'
import { isResendSendConfigured, sendManualEmail } from '../../../lib/outreach-send'
import type { LeadForSend } from '../../../lib/outreach-send'
import { evaluateOutreachRouting } from '../../lib/outreach/routing-rules'

export const dynamic = 'force-dynamic'

// Issue #205 — the first real, rep-initiated send path in this app (every
// prior Resend send is the cadence cron, no human involved). `channel` is
// not accepted: this route is email-only by construction, since LinkedIn
// has no real-send path (automating it is confirmed ToS-infeasible — see
// lib/cadences.ts's own header comment). Auth matches POST
// /api/outreach-logs exactly (requireApiKey) — no new, weaker path.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const body = await request.json()

    const leadId = String(body.leadId || '').trim()
    const brand = String(body.brand || 'default').trim()
    const subject = String(body.subject || '').trim()
    const bodyText = String(body.body || '').trim()
    // Client-generated once per Send click (crypto.randomUUID(), never
    // server-generated) — so a genuine network-level retry of the same
    // click reuses the same key and Resend dedupes it, while two
    // independently rep-initiated sends always get distinct keys.
    const idempotencyKey = String(body.idempotencyKey || '').trim()
    const templateId = body.templateId ? String(body.templateId) : undefined

    if (!leadId || !bodyText || !subject || !idempotencyKey) {
      return NextResponse.json({ error: 'leadId, subject, body, and idempotencyKey are required' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }
    // Sending is never silently downgraded to record-only — the rep sees an
    // explicit error and can still use "Log outreach" regardless (issue
    // #205's own Edge Cases: a brand/environment without Resend configured
    // never loses the ability to record outreach).
    if (!isResendSendConfigured()) {
      return NextResponse.json({ error: 'Email sending is not configured for this environment' }, { status: 503 })
    }

    const contacts = Array.isArray(body.contacts) ? body.contacts : []

    // Same pre-check pattern POST /api/outreach-logs already runs, for a
    // clean, immediate 400 on a structurally ineligible request (e.g. no
    // decision-maker contact at all) — dispatchOutreachEmail()'s own
    // internal re-check (issue #150's established defense-in-depth
    // convention) still runs regardless and is authoritative for anything
    // that changes between this check and the actual send.
    const routing = evaluateOutreachRouting('email', { contacts, url: body.url }, bodyText)
    if (!routing.allowed) {
      return NextResponse.json({ error: routing.reason || 'Outreach not allowed for this channel/lead state.' }, { status: 400 })
    }

    const client = await clientPromise
    const db = client.db()

    const lead: LeadForSend = {
      _id: leadId,
      entity_name: body.entity_name,
      contacts,
      url: body.url,
      industry: body.industry,
      sport_or_sector: body.sport_or_sector,
    }

    // The compose modal sends the rep's own final, already-interpolated
    // (and possibly hand-edited) subject/body — wrapped as a template
    // object rather than re-resolving templateId server-side, since a real
    // send must use exactly what's on screen, not re-derive it. interpolate()
    // is a safe no-op on text with no remaining {key} tokens, which is true
    // for any realistic rep-composed message.
    const template = {
      id: templateId || 'manual-compose',
      name: 'Manual compose',
      channel: 'email' as const,
      industry: '',
      subject,
      body: bodyText,
      variables: [] as string[],
    }

    const result = await sendManualEmail(db, lead, template, { brand, tenantId, idempotencyKey })

    return NextResponse.json({ sent: result.sent, reason: result.reason, outreachLogId: result.outreachLogId })
  } catch (error: any) {
    console.error('[API:outreach-send] POST error:', error)
    return NextResponse.json({ error: 'Failed to send outreach email', details: error.message }, { status: 500 })
  }
}
