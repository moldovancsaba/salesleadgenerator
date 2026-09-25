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
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '../app/lib/activity-log-store';

export type AutomatedSendContext = {
  brand: string;
  tenantId: string;
  cadenceId: string;
  stepIndex: number;
};

// Issue #205 — one-off, rep-initiated send. idempotencyKey is generated
// client-side once per click (never server-side — see
// app/api/outreach-send/route.ts) so a genuine network-level retry of the
// same click reuses the same key (Resend dedupes it) while two distinct
// rep-initiated sends always get distinct keys.
export type ManualSendContext = {
  brand: string;
  tenantId: string;
  idempotencyKey: string;
};

// The one thing that actually differs between a cadence step firing itself
// and a rep clicking Send: how the idempotency key is built and whether the
// resulting outreach_logs row is tagged sentAutomatically. Everything else
// (routing check, interpolation, the Resend call itself, log-writing) is one
// shared path — see dispatchOutreachEmail() below.
//
// 'quote' (issue #211) — a third, one-off rep-initiated kind alongside
// 'manual': a Quote's "Send" action, distinguished only by tagging the
// resulting outreach_logs row with quoteId so it's traceable back to the
// specific Quote it sent, never a second/parallel send implementation.
export type OutreachSendSource =
  | { kind: 'cadence'; cadenceId: string; stepIndex: number }
  | { kind: 'manual'; idempotencyKey: string }
  | { kind: 'quote'; quoteId: string; idempotencyKey: string };

export type AutomatedSendResult = {
  sent: boolean;
  // Set whenever sent is false — why the send didn't happen (routing
  // ineligible, no template, or a Resend-side rejection/failure).
  reason?: string;
  outreachLogId: string;
  // Present only when sent === true — Resend's own returned email id,
  // needed by the caller to correlate a later delivery/open/click webhook
  // event back to this specific send.
  resendEmailId?: string;
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
  context: { brand: string; tenantId: string },
  leadId: string,
  fields: {
    templateId?: string;
    subject?: string;
    body: string;
    routingAllowed: boolean;
    routingReason: string | null;
    // Issue #205 — sendAttempted distinguishes a row this module wrote
    // (always true here) from a POST /api/outreach-logs record-only row
    // (which never sets this field at all) — sentAutomatically alone is
    // ambiguous, since false/absent covers both a Log-outreach row and a
    // manual real-send row.
    sendAttempted: true;
    resendEmailId?: string;
    sentAutomatically: boolean;
    cadenceId?: string;
    stepIndex?: number;
    // Issue #211 — set only for a Quote "Send" action, tracing this
    // outreach_logs row back to the specific Quote it sent.
    quoteId?: string;
    // Set true only once a corresponding activityLog row has also been
    // written for this send (successful manual sends only) — the read-side
    // merge in GET /api/leads/[id]/activity excludes a row with this set,
    // since it would otherwise render twice in one lead's timeline (once
    // via this collection's own existing outreach_logs->email-outbound
    // mapping, once via the new activityLog row). A cadence send never sets
    // this — it has no activityLog row, so it keeps rendering exactly as it
    // always has.
    activityLogWritten?: boolean;
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
    // row simply lacks the cadence-only ones rather than needing a schema
    // migration.
    sendAttempted: fields.sendAttempted,
    resendEmailId: fields.resendEmailId,
    sentAutomatically: fields.sentAutomatically,
    cadenceId: fields.cadenceId,
    stepIndex: fields.stepIndex,
    quoteId: fields.quoteId,
    activityLogWritten: fields.activityLogWritten,
  });
  return result.insertedId.toString();
}

// Issue #205 — writes the activityLog entry for a successful MANUAL send
// only (never for a cadence send, which has no activityLog row of its own —
// see writeOutreachLog's own comment on activityLogWritten). externalId
// carries the sparse+unique index app/lib/activity-log-store.ts's
// ensureActivityLogIndexes() already creates for the inbound-webhook path —
// reused here for the identical purpose: a retried call with the same
// resendEmailId (e.g. this same dispatchOutreachEmail() re-invoked with the
// same idempotencyKey after a network-level retry) hits a duplicate-key
// error, treated as already-processed rather than a second timeline entry.
async function writeManualSendActivityLog(
  db: Db,
  context: { brand: string; tenantId: string },
  leadId: string,
  fields: { resendEmailId: string; subject: string; body: string }
): Promise<boolean> {
  try {
    await ensureActivityLogIndexes(db);
    await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
      leadId,
      tenantId: context.tenantId,
      brand: context.brand,
      type: 'email-outbound',
      direction: 'outbound',
      subject: fields.subject,
      bodyExcerpt: truncateBody(fields.body),
      matchedContactKey: null,
      source: 'manual',
      externalId: fields.resendEmailId,
      createdAt: new Date(),
    });
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return true; // already processed (retry) — not an error
    // Non-fatal: outreach_logs is already the source-of-truth record of the
    // send itself; a failure writing this secondary Activity-timeline entry
    // must never make an otherwise-successful send look like it failed.
    console.error('[lib/outreach-send] activityLog write for manual send failed', err);
    return false;
  }
}

// The shared core both sendAutomatedEmail() (cadence) and sendManualEmail()
// (issue #205, rep-initiated) call — the only difference between the two is
// how the idempotency key is built and which outreach_logs fields get
// stamped, per OutreachSendSource. Never throws (source.kind === 'cadence'
// depends on this for cron batch safety, per this function's own original
// header comment); every call writes exactly one outreach_logs entry,
// success or failure, so the send history is complete either way.
export async function dispatchOutreachEmail(
  db: Db,
  lead: LeadForSend,
  template: OutreachTemplate | null,
  context: { brand: string; tenantId: string },
  source: OutreachSendSource
): Promise<AutomatedSendResult> {
  const leadId = lead._id;
  const sentAutomatically = source.kind === 'cadence';
  const cadenceFields = source.kind === 'cadence' ? { cadenceId: source.cadenceId, stepIndex: source.stepIndex }
    : source.kind === 'quote' ? { quoteId: source.quoteId }
    : {};

  if (!template) {
    const outreachLogId = await writeOutreachLog(db, context, leadId, {
      body: '',
      routingAllowed: false,
      routingReason: 'template not found',
      sendAttempted: true,
      sentAutomatically,
      ...cadenceFields,
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
      sendAttempted: true,
      sentAutomatically,
      ...cadenceFields,
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
      sendAttempted: true,
      sentAutomatically,
      ...cadenceFields,
    });
    return { sent: false, reason: 'Missing decision maker email for email outreach.', outreachLogId };
  }

  // Idempotency-Key, not a duplicate send. Cadence: a retried cron tick
  // (issue #151) for the same lead/step resolves to the same key, so Resend
  // itself dedupes rather than this module needing to track its own
  // "already sent this tick" state. Manual (issue #205): built from the
  // client-generated idempotencyKey so a genuine network-level retry of the
  // same rep click reuses the same key, while two independently rep-
  // initiated sends always get distinct keys.
  const idempotencyKey = source.kind === 'cadence'
    ? `cadence-${source.cadenceId}-${leadId}-${source.stepIndex}`
    : source.kind === 'quote'
    ? `quote-${source.quoteId}-${leadId}-${source.idempotencyKey}`
    : `manual-${leadId}-${source.idempotencyKey}`;

  let sendError: string | undefined;
  let resendEmailId: string | undefined;
  try {
    const brandConfig = await getBrandConfig(context.brand);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
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
    } else {
      resendEmailId = data?.id;
    }
  } catch (err: any) {
    // Network error, timeout, or any other throw from the SDK itself
    // (distinct from a well-formed API error response, which resolves
    // through `error` above without throwing) — caught here so a transient
    // Resend outage can never abort a cron tick's whole batch, and never
    // leaves a rep-initiated send hanging with no error surfaced either.
    sendError = err?.message || 'Resend request failed';
  }

  let activityLogWritten = false;
  if (!sendError && (source.kind === 'manual' || source.kind === 'quote') && resendEmailId) {
    activityLogWritten = await writeManualSendActivityLog(db, context, leadId, { resendEmailId, subject, body });
  }

  const outreachLogId = await writeOutreachLog(db, context, leadId, {
    templateId: template.id,
    subject,
    body,
    routingAllowed: !sendError,
    routingReason: sendError ? `resend rejected: ${sendError}` : null,
    sendAttempted: true,
    resendEmailId,
    sentAutomatically,
    ...cadenceFields,
    activityLogWritten,
  });

  if (sendError) {
    return { sent: false, reason: `resend rejected: ${sendError}`, outreachLogId };
  }
  return { sent: true, outreachLogId, resendEmailId };
}

// Sends one cadence email step to one lead, or explains why it didn't.
// Thin wrapper over dispatchOutreachEmail() — this exported signature and
// every behavior it produces (idempotency key, cadenceId/stepIndex fields,
// the cron call site) is unchanged from before issue #205's refactor; the
// cadence-send integration tests assert this explicitly.
export async function sendAutomatedEmail(
  db: Db,
  lead: LeadForSend,
  template: OutreachTemplate | null,
  context: AutomatedSendContext
): Promise<AutomatedSendResult> {
  return dispatchOutreachEmail(
    db,
    lead,
    template,
    { brand: context.brand, tenantId: context.tenantId },
    { kind: 'cadence', cadenceId: context.cadenceId, stepIndex: context.stepIndex }
  );
}

// Issue #205 — the new rep-initiated, one-off send path. Thin wrapper over
// the same dispatchOutreachEmail() core cadence sends use, diverging only in
// idempotency-key construction and which outreach_logs fields get stamped.
export async function sendManualEmail(
  db: Db,
  lead: LeadForSend,
  template: OutreachTemplate | null,
  context: ManualSendContext
): Promise<AutomatedSendResult> {
  return dispatchOutreachEmail(
    db,
    lead,
    template,
    { brand: context.brand, tenantId: context.tenantId },
    { kind: 'manual', idempotencyKey: context.idempotencyKey }
  );
}

// Deals: Quote generation (issue #211) — a third thin wrapper over the same
// dispatchOutreachEmail() core, reusing this module's Resend client
// construction, resolveOutboundFromAddress(), and outreach_logs write
// pattern exactly as issue #211 §7 requires ("no second, parallel
// email-sending code path"). A quote send has no user-editable outreach
// template — it's a synthetic, fixed one built here referencing
// {quote_link}, interpolated the same way any other template's {key}
// placeholders are (app/lib/outreach/default-templates.ts's interpolate()),
// by decorating the lead object with a quote_link field before it reaches
// dispatchOutreachEmail's own interpolationValues spread. Still runs
// through evaluateOutreachRouting's real eligibility check (a lead with no
// decision-maker email is no more sendable a quote to than a template
// email) — not a routing bypass.
export async function sendQuoteEmail(
  db: Db,
  lead: LeadForSend,
  params: { quoteId: string; viewUrl: string; brandLabel: string; idempotencyKey: string },
  context: { brand: string; tenantId: string }
): Promise<AutomatedSendResult> {
  const template: OutreachTemplate = {
    id: 'quote-share-link',
    name: 'Quote share link',
    channel: 'email',
    industry: '',
    subject: `Your quote from ${params.brandLabel}`,
    body: `Hi {contact_name},\n\nPlease find your quote from ${params.brandLabel} here: {quote_link}\n\nLet us know if you have any questions.`,
    variables: ['contact_name', 'quote_link'],
  };
  return dispatchOutreachEmail(
    db,
    { ...lead, quote_link: params.viewUrl },
    template,
    { brand: context.brand, tenantId: context.tenantId },
    { kind: 'quote', quoteId: params.quoteId, idempotencyKey: params.idempotencyKey }
  );
}
