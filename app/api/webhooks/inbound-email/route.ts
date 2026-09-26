import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { extractResendWebhookHeaders, verifyResendWebhook, isResendConfigured } from '../../../../lib/resend-webhook'
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes } from '../../../lib/activity-log-store'
import { buildActivityLogDoc, bareAddress, resolveBrandFromAddress, type ReceivedEmailEvent } from '../../../lib/inbound-email'
import {
  matchReplyToLeads,
  findMatchedContact,
  generateContactSuggestion,
  ensureContactSuggestionsIndexes,
} from '../../../../lib/contact-reply-matching'
import { contactKey } from '../../../../lib/contacts'
import type { Brand } from '../../../lib/brand'
import { getAllBrandConfigs } from '../../../lib/brand'

// A generous cap for what should be a small, metadata-only payload
// (resend.com/docs/dashboard/receiving/introduction confirms the webhook
// itself never carries the email body/attachments) — real traffic from
// Resend won't get anywhere near this; this exists to reject a malformed or
// abusive request before it's ever parsed.
const MAX_BODY_BYTES = 2 * 1024 * 1024

// Issue #205 — outbound delivery-lifecycle event coverage, added onto this
// same endpoint (kept as one Resend webhook object, subscribed to both
// email.received and these new types, rather than a second endpoint with
// its own separate signing secret — see docs/ARCHITECTURE.md's "Outbound
// email tracking" section for the full reasoning and the deliberate
// decision to keep this route's name despite now covering both directions).
const DELIVERY_STATUS_BY_EVENT: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
}

const RESEND_WEBHOOK_EVENT_COLLECTION = 'resend_webhook_event_ids'
// 30 days — events this old have no realistic reason to still be retried
// by Resend; matches the TTL-collection convention lib/bulk-undo.ts already
// established (expireAfterSeconds: an exact stored date, not a relative one).
const WEBHOOK_EVENT_ID_TTL_SECONDS = 30 * 24 * 60 * 60

let deliveryEventIndexesEnsured = false
async function ensureDeliveryEventIndexes(db: import('mongodb').Db): Promise<void> {
  if (deliveryEventIndexesEnsured) return
  try {
    await db.collection(RESEND_WEBHOOK_EVENT_COLLECTION).createIndex({ svixId: 1 }, { unique: true })
    await db.collection(RESEND_WEBHOOK_EVENT_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    deliveryEventIndexesEnsured = true
  } catch (error) {
    console.error('[webhooks/inbound-email] delivery-event index creation failed', error)
  }
}

// Updates the outreach_logs row a manual send (or a cadence send) wrote,
// identified by Resend's own returned email id — never the activityLog
// collection, deliberately: issue #205's own Architecture explicitly avoids
// a new activityLog row per lifecycle event (a lead opening the same email
// three times would otherwise spam the Activity timeline with three
// identical-looking entries). Dedup is on the event's own svix-id (the
// Standard Webhooks/Resend-documented at-least-once delivery id) rather than
// any payload field — an emailId repeats across every lifecycle event for
// the SAME email, so it can't itself distinguish "this exact event, retried"
// from "a genuinely new, later event for the same email."
async function handleDeliveryEvent(db: import('mongodb').Db, event: any, svixEventId: string) {
  const emailId = String(event.data?.email_id || '')
  if (!emailId) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  await ensureDeliveryEventIndexes(db)
  try {
    await db.collection(RESEND_WEBHOOK_EVENT_COLLECTION).insertOne({
      svixId: svixEventId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + WEBHOOK_EVENT_ID_TTL_SECONDS * 1000),
    })
  } catch (err: any) {
    if (err?.code === 11000) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    throw err
  }

  const status = DELIVERY_STATUS_BY_EVENT[event.type]
  const update: Record<string, any> = { $set: { deliveryStatus: status, deliveryStatusUpdatedAt: new Date() } }
  if (event.type === 'email.opened') update.$inc = { openCount: 1 }
  if (event.type === 'email.clicked') update.$inc = { clickCount: 1 }

  // Matches zero documents cleanly (e.g. an event for a brand/environment
  // where this feature isn't deployed yet, or a stray event) — not an
  // error, per issue #205's own Edge Cases.
  await db.collection('outreach_logs').updateOne({ resendEmailId: emailId }, update)

  return NextResponse.json({ ok: true })
}

function stripHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || undefined
}

// Issue #141 — the first real writer to activityLog (issue #140). Auth is
// deliberately NOT requireApiKey/requireCronOrApiKey (lib/api-auth.ts) —
// those assume the caller already holds our own secret; a third-party
// webhook authenticates with its own signature scheme instead (verified
// against the real installed `resend` package's source, not assumed from
// docs alone — see lib/resend-webhook.ts).
export async function POST(request: NextRequest) {
  try {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'Inbound email not configured' }, { status: 503 })
    }
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    // Must be the exact raw bytes the request arrived with — signature
    // verification hashes this string directly, so parsing to JSON first
    // and re-serializing would produce a different (and wrongly rejected)
    // byte sequence on any whitespace/key-order difference.
    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    const headers = extractResendWebhookHeaders(request.headers)
    if (!headers) {
      return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 400 })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)

    let event: any
    try {
      event = verifyResendWebhook(resend, rawBody, headers, process.env.RESEND_WEBHOOK_SECRET as string)
    } catch (err) {
      console.error('[inbound-email webhook] signature verification failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    if (!event) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const client = await getClientPromise()
    const db = client.db()

    // Issue #205 — this endpoint's own Resend webhook subscription is now
    // extended beyond email.received (see this file's header comment) to
    // also cover outbound delivery-lifecycle events, routed here to a
    // dedicated handler that updates outreach_logs, never activityLog.
    if (event.type in DELIVERY_STATUS_BY_EVENT) {
      return handleDeliveryEvent(db, event, headers.id)
    }

    if (event.type !== 'email.received') {
      // Any other event type this endpoint might ever receive is
      // acknowledged, not treated as an error — Resend retries a non-2xx
      // response, and there's nothing to retry here.
      return NextResponse.json({ ok: true, ignored: true })
    }

    await ensureActivityLogIndexes(db)

    const data = event.data || {}
    const receivedEvent: ReceivedEmailEvent = {
      emailId: String(data.email_id || ''),
      from: String(data.from || ''),
      to: Array.isArray(data.to) ? data.to : [],
      cc: Array.isArray(data.cc) ? data.cc : [],
      bcc: Array.isArray(data.bcc) ? data.bcc : [],
      receivedFor: Array.isArray(data.received_for) ? data.received_for : [],
      subject: String(data.subject || ''),
      messageId: String(data.message_id || ''),
    }

    if (!receivedEvent.emailId) {
      return NextResponse.json({ error: 'Malformed event: missing email_id' }, { status: 400 })
    }

    // The webhook payload is metadata-only by design — fetch the real body
    // via a follow-up API call. Never fails the whole request: a lead's
    // reply is still worth recording (subject, from/to, timestamp) even if
    // this specific call fails, matching this route's own "don't silently
    // drop real data" principle for the rest of the payload.
    let bodyExcerpt: string | undefined
    try {
      const { data: fullEmail, error } = await resend.emails.receiving.get(receivedEvent.emailId)
      if (error) {
        console.error('[inbound-email webhook] failed to fetch full email content', error)
      } else {
        bodyExcerpt = fullEmail?.text || stripHtml(fullEmail?.html) || undefined
      }
    } catch (err) {
      console.error('[inbound-email webhook] failed to fetch full email content', err)
    }

    const allBrands = Object.keys(await getAllBrandConfigs()) as Brand[]
    const doc = buildActivityLogDoc(receivedEvent, bodyExcerpt, new Date(), allBrands)

    // Issue #230 — direction comes from who matches a lead, not from where
    // our address sits in the headers. The header rule misread a routed copy
    // of a lead's reply (our address only in received_for) as outbound, and
    // a rep's outreach that CCs our address as inbound. Sender match first:
    // a lead contact who wrote it makes it inbound (issue #142's reply
    // matching + suggestion). Otherwise a lead contact among the recipients
    // makes it the rep's outbound mail, attached to that lead. Otherwise the
    // header rule from buildActivityLogDoc stands.
    if (doc.brand !== 'unresolved') {
      const brand = doc.brand as Brand
      await ensureContactSuggestionsIndexes(db)
      const sender = bareAddress(receivedEvent.from)
      const senderMatch = await matchReplyToLeads(db, brand, doc.tenantId, sender)
      if (senderMatch.kind !== 'no-match') {
        doc.direction = 'inbound'
        doc.type = 'email-inbound'
        if (senderMatch.kind === 'single-match') {
          doc.leadId = senderMatch.leadId
          const contact = await findMatchedContact(db, brand, doc.tenantId, senderMatch.leadId, sender)
          if (contact) {
            doc.matchedContactKey = contactKey(contact)
          }
        } else {
          // Flagged for manual disambiguation, not guessed — leadId stays
          // null, same as the zero-match case, per issue #142's own spec.
          doc.matchedLeadIds = senderMatch.leadIds
        }
      } else {
        const recipients = [...receivedEvent.to, ...receivedEvent.cc, ...receivedEvent.bcc]
          .map(bareAddress)
          .filter((address, index, all) => address && all.indexOf(address) === index && !resolveBrandFromAddress(address, allBrands))
        const leadIds = new Set<string>()
        for (const recipient of recipients) {
          const match = await matchReplyToLeads(db, brand, doc.tenantId, recipient)
          if (match.kind === 'single-match') leadIds.add(match.leadId)
          if (match.kind === 'multi-match') match.leadIds.forEach((id) => leadIds.add(id))
        }
        if (leadIds.size > 0) {
          doc.direction = 'outbound'
          doc.type = 'email-outbound'
          if (leadIds.size === 1) doc.leadId = [...leadIds][0]
          else doc.matchedLeadIds = [...leadIds]
        }
      }
    }

    let insertedId: unknown
    try {
      const result = await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(doc)
      insertedId = result.insertedId
    } catch (err: any) {
      if (err?.code === 11000) {
        // Duplicate externalId — a webhook retry (at-least-once delivery is
        // standard for Resend and every other inbound-email provider),
        // already processed. Acknowledge, don't error or duplicate.
        return NextResponse.json({ ok: true, duplicate: true })
      }
      throw err
    }

    // Enrichment suggestion generation happens after the activityLog write
    // succeeds (needs its _id as sourceActivityLogId) and never fails the
    // request — a signature-parsing miss or a transient error here must not
    // turn an already-successfully-logged reply into a 500 the webhook
    // sender would retry.
    // Inbound only: an outbound capture's signature is the rep's own, never
    // an enrichment signal for the lead's contact (issue #230).
    if (doc.leadId && doc.direction === 'inbound') {
      try {
        await generateContactSuggestion(
          db,
          doc.brand as Brand,
          doc.tenantId,
          doc.leadId,
          receivedEvent.from,
          bodyExcerpt,
          String(insertedId)
        )
      } catch (err) {
        console.error('[inbound-email webhook] contact-suggestion generation failed', err)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('POST /api/webhooks/inbound-email Error:', error)
    return NextResponse.json({ error: 'Failed to process inbound email' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
