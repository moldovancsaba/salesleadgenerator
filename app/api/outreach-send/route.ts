import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { isResendSendConfigured, sendManualEmail } from '../../../lib/outreach-send'
import type { LeadForSend } from '../../../lib/outreach-send'
import { evaluateOutreachRouting } from '../../lib/outreach/routing-rules'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import { ObjectId, type Db } from 'mongodb'

export const dynamic = 'force-dynamic'

// Same ObjectId -> numeric `id` -> string id/_id fallback as tryFindLead in
// app/api/leads/[id]/route.ts, scoped to the brand's own lead collection and
// tenant. $and (not a spread) keeps the default tenant's own $or intact.
async function findLead(db: Db, collection: string, tenantId: string, rawId: string) {
  const filter = tenantFilter(tenantId)

  if (ObjectId.isValid(rawId)) {
    const lead = await db.collection(collection).findOne({ _id: new ObjectId(rawId), ...filter })
    if (lead) return lead
  }

  const numericId = Number(rawId)
  if (Number.isFinite(numericId)) {
    return db.collection(collection).findOne({ id: numericId, ...filter })
  }

  return db.collection(collection).findOne({
    $and: [
      { $or: [{ id: rawId }, { _id: rawId as any }] },
      filter,
    ],
  })
}

// Issue #205 — the first real, rep-initiated send path in this app (every
// prior Resend send is the cadence cron, no human involved). `channel` is
// not accepted: this route is email-only by construction, since LinkedIn
// has no real-send path (automating it is confirmed ToS-infeasible — see
// lib/cadences.ts's own header comment). Issue #227: auth is
// requireBrandAccessApi (legacy x-api-key, a scoped key for this brand, or
// an SSO session with access to it), the same brand gate as POST
// /api/outreach-logs, so the compose modal's own session can send.
export async function POST(request: NextRequest) {
  try {
    const tenantId = getTenantId(request)
    // Parsed before auth only so `brand` can fall back to the body; an
    // unparseable body still reaches the auth check (and then 400s).
    const body = await request.json().catch(() => ({} as Record<string, any>))

    const brand = await resolveBrand(new URL(request.url).searchParams.get('brand') || body.brand)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const leadId = String(body.leadId || '').trim()
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

    const client = await clientPromise
    const db = client.db()

    // Issue #227: recipients and interpolation fields come from the stored
    // lead in this brand's own collection, never from the request body — a
    // caller can only email a lead's real decision-maker, and only for a
    // lead in a brand it is authorized for.
    const config = (await getBrandConfig(brand))!
    const stored = await findLead(db, config.dbCollection, tenantId, leadId)
    if (!stored) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const contacts = Array.isArray(stored.contacts) ? stored.contacts : []

    // Same pre-check pattern POST /api/outreach-logs already runs, for a
    // clean, immediate 400 on a structurally ineligible request (e.g. no
    // decision-maker contact at all) — dispatchOutreachEmail()'s own
    // internal re-check (issue #150's established defense-in-depth
    // convention) still runs regardless and is authoritative for anything
    // that changes between this check and the actual send.
    const routing = evaluateOutreachRouting('email', { contacts, url: stored.url }, bodyText)
    if (!routing.allowed) {
      return NextResponse.json({ error: routing.reason || 'Outreach not allowed for this channel/lead state.' }, { status: 400 })
    }

    const lead: LeadForSend = {
      _id: leadId,
      entity_name: stored.entity_name,
      contacts,
      url: stored.url,
      industry: stored.industry,
      sport_or_sector: stored.sport_or_sector,
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
