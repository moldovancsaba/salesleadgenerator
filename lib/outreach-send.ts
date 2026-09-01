// Automated email-step sends for sales cadences (issue #124/#150). The one
// channel a cadence actually auto-sends — LinkedIn's User Agreement forbids
// automated message sending (confirmed by real research, see issue #124's
// own Executive Summary and lib/cadences.ts's header comment), so a
// `linkedin`/`call` step is routed to a human reminder instead (issue
// #151's job) and never reaches this module.
//
// Deliberately reuses this app's existing outreach machinery unchanged
// rather than reimplementing it: `evaluateOutreachRouting()` (the same
// eligibility check a manual send already goes through), `interpolate()`
// (the same `{key}` template substitution the compose modal uses), and the
// `outreach_logs` collection/schema `POST /api/outreach-logs` already
// writes to — this only adds the transport (Resend) and 3 new, additive
// fields (`cadenceId`, `stepIndex`, `sentAutomatically`) so an automated
// send is indistinguishable from a manual one to every existing reader of
// that collection except by those new fields' presence.

import type { Db } from 'mongodb';
import { Resend } from 'resend';
import { evaluateOutreachRouting, type LeadFieldSnapshot } from '../app/lib/outreach/routing-rules';
import { interpolate, type OutreachTemplate } from '../app/lib/outreach/default-templates';
import { getDecisionMakerContact } from './contacts';
import { getBrandConfig } from '../app/lib/brand';

export type AutomatedSendContext = {
  brand: string;
  tenantId: string;
  cadenceId: string;
  stepIndex: number;
};

export type AutomatedSendResult = {
  sent: boolean;
  // Set whenever sent is false — why the send didn't happen (routing
  // ineligible, no template, or a Resend-side rejection/failure).
  reason?: string;
  outreachLogId: string;
};

// Just enough of a Lead to route and interpolate — matches
// routing-rules.ts's own LeadFieldSnapshot convention of a narrow local
// type rather than importing the full 250-field Lead type for a module
// that only ever reads a handful of its fields.
export type LeadForSend = LeadFieldSnapshot & {
  _id: string;
  contacts?: Array<{ name?: string; email?: string; isDecisionMaker?: boolean }>;
  [key: string]: any;
};

export function isResendSendConfigured(): boolean {
  // Sending only needs the API key — RESEND_WEBHOOK_SECRET
  // (lib/resend-webhook.ts's isResendConfigured()) is inbound-only and
  // irrelevant here; reusing that check would wrongly gate outbound send on
  // an inbound-only secret being configured too.
  return !!process.env.RESEND_API_KEY;
}

// The exact from-address is a real, live-account fact this sandbox cannot
// verify (no RESEND_API_KEY here) — same disclosed gap as issue #141's own
// "not yet live" section. Issue #195 — the per-brand override used to be the
// RESEND_FROM_<BRAND> env var; it's now the brand's own `fromEmail` field
// (app/lib/brand.ts's BrandConfig), passed in by the caller instead of read
// from process.env here, so a new brand's sender address is configurable
// through the same admin flow as the rest of its config, no env var/deploy
// needed. The `${brand}@${domain}` default assumes sending is verified on
// the brand-scoped local part of RESEND_OUTBOUND_DOMAIN (defaults to
// `haho.ai`, the root domain docs/STACK_AND_DEPENDENCIES.md confirms is
// sending-verified) — never assumed live without an operator confirming it.
export function resolveOutboundFromAddress(brand: string, fromEmail?: string): string {
  if (fromEmail) return fromEmail;
  const domain = process.env.RESEND_OUTBOUND_DOMAIN || 'haho.ai';
  return `${brand}@${domain}`;
}

async function writeOutreachLog(
  db: Db,
  context: AutomatedSendContext,
  leadId: string,
  fields: {
    templateId?: string;
    subject?: string;
    body: string;
    routingAllowed: boolean;
    routingReason: string | null;
  }
): Promise<string> {
  const result = await db.collection('outreach_logs').insertOne({
    tenantId: context.tenantId,
    leadId,
    brand: context.brand,
    templateId: fields.templateId,
    channel: 'email',
    subject: fields.subject,
    body: fields.body,
    routingAllowed: fields.routingAllowed,
    routingReason: fields.routingReason,
    createdAt: new Date(),
    // Additive-only — every existing outreach_logs reader (GET
    // /api/outreach-logs, template conversion tracking, the Activity
    // timeline merge) ignores fields it doesn't recognize, so a manual-send
    // row simply lacks these rather than needing a schema migration.
    cadenceId: context.cadenceId,
    stepIndex: context.stepIndex,
    sentAutomatically: true,
  });
  return result.insertedId.toString();
}

// Sends one cadence email step to one lead, or explains why it didn't.
// Never throws — a cron tick processing many leads (issue #151) must not
// have one lead's failure (missing template, routing block, Resend error)
// abort the whole batch. Every call writes exactly one outreach_logs entry,
// success or failure, so the send history is complete either way.
export async function sendAutomatedEmail(
  db: Db,
  lead: LeadForSend,
  template: OutreachTemplate | null,
  context: AutomatedSendContext
): Promise<AutomatedSendResult> {
  const leadId = lead._id;

  if (!template) {
    const outreachLogId = await writeOutreachLog(db, context, leadId, {
      body: '',
      routingAllowed: false,
      routingReason: 'template not found',
    });
    return { sent: false, reason: 'template not found', outreachLogId };
  }

  // Same {contact_name} resolution the compose modal uses (issue #45) —
  // templates reference the decision-maker's name, never a top-level
  // decision_maker_name field, which doesn't exist.
  const interpolationValues = { ...lead, contact_name: getDecisionMakerContact(lead.contacts)?.name || '' };
  const subject = template.subject ? interpolate(template.subject, interpolationValues) : '';
  const body = interpolate(template.body, interpolationValues);

  const routing = evaluateOutreachRouting('email', lead, body);
  if (!routing.allowed) {
    const outreachLogId = await writeOutreachLog(db, context, leadId, {
      templateId: template.id,
      subject,
      body,
      routingAllowed: false,
      routingReason: routing.reason || null,
    });
    return { sent: false, reason: routing.reason, outreachLogId };
  }

  // Guaranteed present by evaluateOutreachRouting's own requireEmail check
  // above — re-checked here anyway rather than asserted with `!`, since a
  // send is the one place in this module a wrong assumption would actually
  // reach a real external API.
  const to = getDecisionMakerContact(lead.contacts)?.email;
  if (!to) {
    const outreachLogId = await writeOutreachLog(db, context, leadId, {
      templateId: template.id,
      subject,
      body,
      routingAllowed: false,
      routingReason: 'Missing decision maker email for email outreach.',
    });
    return { sent: false, reason: 'Missing decision maker email for email outreach.', outreachLogId };
  }

  // Idempotency-Key, not a duplicate send: a retried cron tick (issue #151)
  // for the same lead/step resolves to the same key, so Resend itself
  // dedupes rather than this module needing to track its own "already sent
  // this tick" state.
  const idempotencyKey = `cadence-${context.cadenceId}-${leadId}-${context.stepIndex}`;

  let sendError: string | undefined;
  try {
    const brandConfig = await getBrandConfig(context.brand);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send(
      {
        from: resolveOutboundFromAddress(context.brand, brandConfig?.fromEmail),
        to,
        subject,
        text: body,
      },
      { idempotencyKey }
    );
    if (error) {
      sendError = error.message || error.name;
    }
  } catch (err: any) {
    // Network error, timeout, or any other throw from the SDK itself
    // (distinct from a well-formed API error response, which resolves
    // through `error` above without throwing) — caught here so a transient
    // Resend outage can never abort a cron tick's whole batch.
    sendError = err?.message || 'Resend request failed';
  }

  const outreachLogId = await writeOutreachLog(db, context, leadId, {
    templateId: template.id,
    subject,
    body,
    routingAllowed: !sendError,
    routingReason: sendError ? `resend rejected: ${sendError}` : null,
  });

  if (sendError) {
    return { sent: false, reason: `resend rejected: ${sendError}`, outreachLogId };
  }
  return { sent: true, outreachLogId };
}
