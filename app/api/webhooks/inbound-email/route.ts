import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { extractResendWebhookHeaders, verifyResendWebhook, isResendConfigured } from '../../../../lib/resend-webhook'
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes } from '../../../lib/activity-log-store'
import { buildActivityLogDoc, type ReceivedEmailEvent } from '../../../lib/inbound-email'
import {
  matchReplyToLeads,
  findMatchedContact,
  generateContactSuggestion,
  ensureContactSuggestionsIndexes,
} from '../../../../lib/contact-reply-matching'
import { contactKey } from '../../../../lib/contacts'
import type { Brand } from '../../../lib/brand'

// A generous cap for what should be a small, metadata-only payload
// (resend.com/docs/dashboard/receiving/introduction confirms the webhook
// itself never carries the email body/attachments) — real traffic from
// Resend won't get anywhere near this; this exists to reject a malformed or
// abusive request before it's ever parsed.
const MAX_BODY_BYTES = 2 * 1024 * 1024

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

    if (!event || event.type !== 'email.received') {
      // Any other event type this endpoint might receive (it should only
      // ever be subscribed to email.received in the Resend dashboard) is
      // acknowledged, not treated as an error — Resend retries a
      // non-2xx response, and there's nothing to retry here.
      return NextResponse.json({ ok: true, ignored: true })
    }

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

    const client = await getClientPromise()
    const db = client.db()
    await ensureActivityLogIndexes(db)

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

    const doc = buildActivityLogDoc(receivedEvent, bodyExcerpt, new Date())

    // Issue #142 — reply-to-lead matching + contact-enrichment suggestion.
    // Only for a genuine inbound reply with a brand we recognize; an
    // outbound-capture entry or an unresolved brand has nothing to match
    // against. `receivedEvent.from` is the lead's own address here (the
    // "non-our-address party" for an inbound-classified event is always the
    // sender, never to/cc, which is why direction resolved 'inbound' in the
    // first place).
    if (doc.direction === 'inbound' && doc.brand !== 'unresolved') {
      const brand = doc.brand as Brand
      await ensureContactSuggestionsIndexes(db)
      const match = await matchReplyToLeads(db, brand, doc.tenantId, receivedEvent.from)
      if (match.kind === 'single-match') {
        doc.leadId = match.leadId
        const contact = await findMatchedContact(db, brand, doc.tenantId, match.leadId, receivedEvent.from)
        if (contact) {
          doc.matchedContactKey = contactKey(contact)
        }
      } else if (match.kind === 'multi-match') {
        // Flagged for manual disambiguation, not guessed — leadId stays
        // null, same as the zero-match case, per issue #142's own spec.
        doc.matchedLeadIds = match.leadIds
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
    if (doc.leadId) {
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
    return NextResponse.json({ error: 'Failed to process inbound email', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
