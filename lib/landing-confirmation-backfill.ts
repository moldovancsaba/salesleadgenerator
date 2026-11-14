import type { Db } from 'mongodb';
import {
  buildLandingConfirmationEmailContent,
  sendLandingConfirmationEmail,
  resolveLandingFromAddress,
} from './landing-confirmation-email';
import { LandingPageRecord, landingPassesEnabled } from './landing-page-schema';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '../app/lib/activity-log-store';

export interface SubmittedLeadRecipient {
  leadId: string;
  email: string;
  name: string;
}

export interface CollectRecipientsResult {
  matchedLeads: number;
  uniqueRecipients: number;
  skippedAlreadySent: number;
  pending: SubmittedLeadRecipient[];
}

export interface BackfillDispatchResult {
  dryRun: boolean;
  subject: string;
  matchedLeads: number;
  uniqueRecipients: number;
  skippedAlreadySent: number;
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
  errors: Array<{ email: string; error: string }>;
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !SIMPLE_EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

function resolveContactDisplayName(contactName: unknown, entityName: unknown): string {
  if (typeof contactName === 'string' && contactName.trim()) {
    return contactName.trim();
  }
  if (typeof entityName === 'string' && entityName.trim()) {
    const cleaned = entityName.trim();
    if (!['direct lead', 'individual', 'guest'].includes(cleaned.toLowerCase())) {
      return cleaned;
    }
  }
  return 'Guest';
}

/**
 * Extracts unique, valid recipient contacts across submitted leads and filters out
 * any email addresses that have already been sent the target confirmation email.
 */
export function collectUniqueSubmittedRecipients(
  leads: Array<Record<string, unknown>>,
  alreadySentEmails: Set<string>
): CollectRecipientsResult {
  const seen = new Set<string>();
  const pending: SubmittedLeadRecipient[] = [];
  let skippedAlreadySent = 0;

  for (const lead of leads) {
    const leadId =
      lead._id && typeof (lead._id as { toString?: () => string }).toString === 'function'
        ? (lead._id as { toString: () => string }).toString()
        : typeof lead.id === 'string' || typeof lead.id === 'number'
          ? String(lead.id)
          : '';

    const candidates: Array<{ email: string; name: string }> = [];
    const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
    for (const c of contacts) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      const email = normalizeEmail(rec.email);
      if (email) {
        candidates.push({
          email,
          name: resolveContactDisplayName(rec.name, lead.entity_name),
        });
      }
    }

    if (candidates.length === 0) {
      const fallbackEmails = Array.isArray(lead.contactEmails) ? lead.contactEmails : [];
      for (const raw of fallbackEmails) {
        const email = normalizeEmail(raw);
        if (email) {
          candidates.push({
            email,
            name: resolveContactDisplayName(undefined, lead.entity_name),
          });
        }
      }
    }

    if (candidates.length === 0) {
      const generalEmail = normalizeEmail(lead.general_contact);
      if (generalEmail) {
        candidates.push({
          email: generalEmail,
          name: resolveContactDisplayName(undefined, lead.entity_name),
        });
      }
    }

    for (const candidate of candidates) {
      if (seen.has(candidate.email)) continue;
      seen.add(candidate.email);

      if (alreadySentEmails.has(candidate.email)) {
        skippedAlreadySent++;
      } else {
        pending.push({
          leadId,
          email: candidate.email,
          name: candidate.name,
        });
      }
    }
  }

  return {
    matchedLeads: leads.length,
    uniqueRecipients: seen.size,
    skippedAlreadySent,
    pending,
  };
}

/**
 * MongoDB filter matching leads submitted through a landing campaign form
 * (including repeat-inquiry merges onto existing lead records).
 */
export function buildSubmittedLeadsFilter(campaignSlug: string, tenantId: string): Record<string, unknown> {
  return {
    $and: [
      { $or: [{ tenantId }, { tenantId: 'default' }, { tenantId: { $exists: false } }] },
      {
        $or: [
          { campaign: campaignSlug },
          { tags: campaignSlug },
          { source: `landing_${campaignSlug}` },
          { source: 'inbound' },
          { notes: { $regex: '\\[Inbound Form ' } },
        ],
      },
    ],
  };
}

/**
 * Fetches recipient emails that already received an email with the exact target subject via Resend.
 */
export async function fetchResendSentRecipientsBySubject(
  apiKey: string | undefined,
  subject: string
): Promise<Set<string>> {
  const sent = new Set<string>();
  const trimmedKey = (apiKey || '').trim();
  const normalizedSubject = subject.trim();
  if (!trimmedKey || !normalizedSubject) return sent;

  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
    try {
      const res = await fetch(`https://api.resend.com/emails?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${trimmedKey}` },
      });
      if (!res.ok) break;
      const body = (await res.json()) as {
        has_more?: boolean;
        data?: Array<{ id?: string; subject?: string; to?: string[] }>;
      };
      const items = Array.isArray(body.data) ? body.data : [];
      for (const item of items) {
        if ((item.subject || '').trim() === normalizedSubject && Array.isArray(item.to)) {
          for (const recipient of item.to) {
            const norm = normalizeEmail(recipient);
            if (norm) sent.add(norm);
          }
        }
      }
      if (!body.has_more || items.length === 0) break;
      after = items[items.length - 1]?.id;
      if (!after) break;
    } catch {
      break;
    }
  }

  return sent;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchConfirmationEmailsForLandingPage(params: {
  db: Db;
  brand: string;
  brandLabel: string;
  dbCollection: string;
  fromEmail?: string;
  tenantId: string;
  page: LandingPageRecord;
  dryRun?: boolean;
  limit?: number;
  throttleMs?: number;
}): Promise<BackfillDispatchResult> {
  const {
    db,
    brand,
    brandLabel,
    dbCollection,
    fromEmail,
    tenantId,
    page,
    dryRun = false,
    limit = 50,
    throttleMs = 550,
  } = params;

  const customEmailEnabled = page.confirmationEmail?.enabled === true;
  if (!customEmailEnabled && !landingPassesEnabled(page)) {
    throw new Error('This landing page has both custom confirmation emails and digital passes turned off.');
  }

  const campaignTitle = page.event?.name || page.title || brandLabel || 'Event Entry Confirmation';
  const { subject } = buildLandingConfirmationEmailContent({
    brand,
    brandLabel,
    campaign: page.slug,
    campaignTitle,
    recipientEmail: 'preview@example.com',
    recipientName: 'Guest',
    venue: page.event?.venue,
    eventDate: page.event?.date,
    confirmationEmail: customEmailEnabled ? page.confirmationEmail : undefined,
  });

  const filter = buildSubmittedLeadsFilter(page.slug, tenantId);
  const leads = await db
    .collection(dbCollection)
    .find(filter, { projection: { _id: 1, id: 1, contacts: 1, contactEmails: 1, general_contact: 1, entity_name: 1 } })
    .sort({ createdAt: 1 })
    .toArray();

  // Deduplicate against both MongoDB activityLog and recent Resend history for this exact subject.
  const alreadySentEmails = await fetchResendSentRecipientsBySubject(process.env.RESEND_API_KEY, subject);
  try {
    const existingLogs = await db
      .collection(ACTIVITY_LOG_COLLECTION)
      .find(
        { brand, type: 'email', direction: 'outbound', subject },
        { projection: { matchedContactKey: 1, toAddresses: 1 } }
      )
      .toArray();
    for (const log of existingLogs) {
      const k = normalizeEmail(log.matchedContactKey);
      if (k) alreadySentEmails.add(k);
      if (Array.isArray(log.toAddresses)) {
        for (const addr of log.toAddresses) {
          const e = normalizeEmail(addr);
          if (e) alreadySentEmails.add(e);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  const collected = collectUniqueSubmittedRecipients(leads, alreadySentEmails);
  const cappedLimit = Math.max(1, Math.min(limit, 100));
  const batch = collected.pending.slice(0, cappedLimit);

  if (dryRun) {
    return {
      dryRun: true,
      subject,
      matchedLeads: collected.matchedLeads,
      uniqueRecipients: collected.uniqueRecipients,
      skippedAlreadySent: collected.skippedAlreadySent,
      attempted: 0,
      sent: 0,
      failed: 0,
      remaining: collected.pending.length,
      errors: [],
    };
  }

  try {
    await ensureActivityLogIndexes(db);
  } catch {
    // Non-fatal
  }

  let sentCount = 0;
  let failedCount = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (let i = 0; i < batch.length; i++) {
    const recipient = batch[i];
    if (i > 0 && throttleMs > 0) {
      await sleep(throttleMs);
    }

    const res = await sendLandingConfirmationEmail({
      brand,
      brandLabel,
      campaign: page.slug,
      campaignTitle,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      venue: page.event?.venue,
      eventDate: page.event?.date,
      fromEmail,
      confirmationEmail: customEmailEnabled ? page.confirmationEmail : undefined,
    });

    if (res.sent) {
      sentCount++;
      try {
        await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
          leadId: recipient.leadId,
          tenantId,
          brand,
          type: 'email',
          direction: 'outbound',
          fromAddress: res.fromAddress || resolveLandingFromAddress(brand, fromEmail),
          toAddresses: [recipient.email],
          subject,
          bodyExcerpt: truncateBody(
            `Landing page confirmation email sent to ${recipient.name} (${recipient.email}) for campaign "${page.slug}".`
          ),
          matchedContactKey: recipient.email,
          source: 'manual',
          createdAt: new Date(),
        });
      } catch {
        // Non-fatal: already prevented from resending via Resend history too.
      }
    } else {
      failedCount++;
      errors.push({ email: recipient.email, error: res.error || 'Unknown Resend error' });
    }
  }

  return {
    dryRun: false,
    subject,
    matchedLeads: collected.matchedLeads,
    uniqueRecipients: collected.uniqueRecipients,
    skippedAlreadySent: collected.skippedAlreadySent,
    attempted: batch.length,
    sent: sentCount,
    failed: failedCount,
    remaining: Math.max(0, collected.pending.length - batch.length),
    errors,
  };
}
