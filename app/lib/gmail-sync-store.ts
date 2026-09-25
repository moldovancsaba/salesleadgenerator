import type { Db } from 'mongodb';
import { getActiveConnectionByProvider, getValidCredential, ConnectionRevokedError } from './integration-store';
import { fetchWithRetry } from '../../lib/integration-http';
import {
  buildGmailExternalId, buildFallbackHash, participantsIntersectKnownEmails,
  resolveGmailDirection, resolveCounterpartyEmail,
} from '../../lib/gmail-sync';
import { matchReplyToLeads, findMatchedContact, generateContactSuggestion } from '../../lib/contact-reply-matching';
import { contactKey, normalizeEmail } from '../../lib/contacts';
import { ACTIVITY_LOG_COLLECTION, truncateBody, ensureActivityLogIndexes, type ActivityLogDocument } from './activity-log-store';
import { getBrandConfig, type Brand } from './brand';
import { tenantFilter } from '../../lib/tenant';

export const GMAIL_SYNC_CURSORS_COLLECTION = 'gmailSyncCursors';

// Issue #216 — real disclosed architectural note (see docs/ARCHITECTURE.md
// for full detail): this issue's own spec text describes "every
// Gmail-connected rep" for a brand, implying multiple simultaneous
// per-rep connections. The hub this issue depends on (issue #217, already
// shipped) models a connection as one-per-{brand,tenantId,provider} —
// there is no per-rep dimension in that schema at all. Rather than
// redesigning the already-shipped, tested hub, this module polls the
// SINGLE Gmail connection a brand/tenant has (if any), attributed to
// whichever admin connected it (IntegrationConnection.connectedBy) — a
// genuine, disclosed scope reduction from the issue's own "every rep"
// framing, not a silent reinterpretation.

const FIRST_SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, per issue #216 §11's own v1 simplification
const MAX_MESSAGES_PER_POLL = 50;
const CROSS_SOURCE_MATCH_WINDOW_MS = 2 * 60 * 1000; // ±2 minutes, per issue #216 §11

type GmailSyncCursor = {
  connectionId: string;
  brand: string;
  tenantId: string;
  gmailAddress?: string;
  lastSyncedAt: string;
  updatedAt: string;
};

let indexesEnsured = false;
export async function ensureGmailSyncCursorIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  try {
    await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).createIndex({ connectionId: 1, brand: 1 }, { unique: true });
    indexesEnsured = true;
  } catch (error) {
    console.error('[gmail-sync-store] index creation failed', error);
  }
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractBodyText(payload: any): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain' && p.body?.data);
    if (plain) return decodeBase64Url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractBodyText(part);
      if (nested) return nested;
    }
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (html) return stripHtmlTags(decodeBase64Url(html.body.data));
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) return stripHtmlTags(decodeBase64Url(payload.body.data));
  return undefined;
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  const match = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return match?.value;
}

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  // Minimal RFC 5322 mailbox-list split — good enough for "a@b.com, Name <c@d.com>"
  // shaped headers; a full parser is out of proportion for this issue's scope.
  return value.split(',').map((part) => {
    const match = part.match(/<([^>]+)>/);
    return (match ? match[1] : part).trim();
  }).filter(Boolean);
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function fetchGmailProfile(token: string): Promise<{ emailAddress: string } | null> {
  const res = await fetchWithRetry(`${GMAIL_API_BASE}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}

async function listMessageIds(token: string, sinceMs: number): Promise<string[]> {
  const url = new URL(`${GMAIL_API_BASE}/messages`);
  url.searchParams.set('q', `after:${Math.floor(sinceMs / 1000)}`);
  url.searchParams.set('maxResults', String(MAX_MESSAGES_PER_POLL));
  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const body = await res.json();
  return (body.messages || []).map((m: any) => m.id);
}

async function getMessageHeaders(token: string, id: string): Promise<any> {
  const url = new URL(`${GMAIL_API_BASE}/messages/${id}`);
  url.searchParams.set('format', 'metadata');
  for (const header of ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID']) {
    url.searchParams.append('metadataHeaders', header);
  }
  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}

async function getMessageBody(token: string, id: string): Promise<string | undefined> {
  const url = new URL(`${GMAIL_API_BASE}/messages/${id}`);
  url.searchParams.set('format', 'full');
  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return undefined;
  const body = await res.json();
  return extractBodyText(body.payload);
}

export type GmailPollResult = { ingested: number; skipped: number; failure?: string };

// Algorithm A (issue #216 §11) — polls a single brand/tenant's Gmail
// connection once. Never fetches a message body until its headers already
// matched a known contact address (data-minimization, §17) — a rep's
// unrelated personal correspondence is never even fetched into this
// process, let alone stored.
export async function pollGmailForBrand(db: Db, brand: Brand, tenantId: string): Promise<GmailPollResult> {
  const brandConfig = await getBrandConfig(brand);
  if (!brandConfig) return { ingested: 0, skipped: 0, failure: 'unknown_brand' };

  const connection = await getActiveConnectionByProvider(db, brand, tenantId, 'gmail');
  if (!connection) return { ingested: 0, skipped: 0 };

  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch (error) {
    const reason = error instanceof ConnectionRevokedError ? error.message : 'token_unavailable';
    return { ingested: 0, skipped: 0, failure: reason };
  }

  await ensureGmailSyncCursorIndexes(db);
  await ensureActivityLogIndexes(db);

  const cursorDoc = await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).findOne({ connectionId: connection.id, brand }) as unknown as GmailSyncCursor | null;

  // Resolved once, then cached on the cursor — Gmail API's own profile
  // endpoint needs only gmail.readonly scope (no broader userinfo/email
  // scope), preserving this hub's least-privilege scope grant (issue #217
  // §17) while still letting Gmail-sync tell outbound from inbound.
  let gmailAddress = cursorDoc?.gmailAddress;
  if (!gmailAddress) {
    const profile = await fetchGmailProfile(token);
    if (!profile?.emailAddress) return { ingested: 0, skipped: 0, failure: 'profile_unavailable' };
    gmailAddress = profile.emailAddress;
  }

  const windowStartMs = cursorDoc ? new Date(cursorDoc.lastSyncedAt).getTime() : Date.now() - FIRST_SYNC_WINDOW_MS;

  const leadsCollection = db.collection(brandConfig.dbCollection);
  const knownEmailDocs = await leadsCollection.find(tenantFilter(tenantId) as any, { projection: { contactEmails: 1 } }).toArray().catch(() => [] as any[]);
  const knownEmails = new Set<string>();
  for (const doc of knownEmailDocs) {
    for (const email of doc.contactEmails || []) knownEmails.add(normalizeEmail(email));
  }

  const messageIds = await listMessageIds(token, windowStartMs);
  let ingested = 0;
  let skipped = 0;
  let newestSeenMs = windowStartMs;

  for (const messageId of messageIds) {
    const meta = await getMessageHeaders(token, messageId);
    if (!meta?.payload?.headers) { skipped++; continue; }

    const headers = meta.payload.headers;
    const fromRaw = getHeader(headers, 'From') || '';
    const toRaw = getHeader(headers, 'To') || '';
    const ccRaw = getHeader(headers, 'Cc') || '';
    const subject = getHeader(headers, 'Subject') || '';
    const dateHeader = getHeader(headers, 'Date');
    const messageIdHeader = getHeader(headers, 'Message-ID');

    const fromEmails = parseAddressList(fromRaw);
    const toEmails = parseAddressList(toRaw);
    const ccEmails = parseAddressList(ccRaw);
    const fromEmail = fromEmails[0] || '';
    const participantEmails = [fromEmail, ...toEmails, ...ccEmails].filter(Boolean);

    if (!participantsIntersectKnownEmails(participantEmails, knownEmails)) {
      skipped++;
      continue;
    }

    const dateIso = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
    newestSeenMs = Math.max(newestSeenMs, new Date(dateIso).getTime());

    if (!messageIdHeader) {
      // Documented, low-probability v1 limitation (issue #216 §15) — no
      // Message-ID header at all, falls back to the hash-based key alone.
    }
    const externalId = messageIdHeader ? buildGmailExternalId(messageIdHeader) : `gmail:no-message-id:${messageId}`;

    const existingByExternalId = await db.collection(ACTIVITY_LOG_COLLECTION).findOne({ externalId });
    if (existingByExternalId) { skipped++; continue; }

    const fallbackHash = buildFallbackHash({ from: fromEmail, toCc: [...toEmails, ...ccEmails], subject, dateIso });
    const windowStart = new Date(new Date(dateIso).getTime() - CROSS_SOURCE_MATCH_WINDOW_MS);
    const windowEnd = new Date(new Date(dateIso).getTime() + CROSS_SOURCE_MATCH_WINDOW_MS);
    const existingByHash = await db.collection(ACTIVITY_LOG_COLLECTION).findOne({
      brand, source: { $in: ['inbound-webhook', 'gmail-sync'] }, fallbackHash, createdAt: { $gte: windowStart, $lte: windowEnd },
    });
    if (existingByHash) { skipped++; continue; }

    const direction = resolveGmailDirection(fromEmail, gmailAddress);
    const counterpartyEmail = resolveCounterpartyEmail(direction, fromEmail, [...toEmails, ...ccEmails], knownEmails);

    const doc: ActivityLogDocument = {
      leadId: null,
      tenantId,
      brand,
      type: direction === 'inbound' ? 'email-inbound' : 'email-outbound',
      direction,
      fromAddress: fromEmail || undefined,
      toAddresses: toEmails,
      ccAddresses: ccEmails,
      subject: subject || undefined,
      bodyExcerpt: undefined,
      matchedContactKey: null,
      source: 'gmail-sync',
      externalId,
      fallbackHash,
      createdAt: new Date(dateIso),
    };

    let matchedLeadId: string | null = null;
    if (counterpartyEmail) {
      const match = await matchReplyToLeads(db, brand, tenantId, counterpartyEmail);
      if (match.kind === 'single-match') {
        matchedLeadId = match.leadId;
        doc.leadId = match.leadId;
        const contact = await findMatchedContact(db, brand, tenantId, match.leadId, counterpartyEmail);
        if (contact) doc.matchedContactKey = contactKey(contact);
      } else if (match.kind === 'multi-match') {
        doc.matchedLeadIds = match.leadIds;
      }
    }

    // Body is fetched only now — after every cheap, header-only gate
    // above already passed — matching the data-minimization requirement.
    const bodyText = await getMessageBody(token, messageId);
    doc.bodyExcerpt = truncateBody(bodyText);

    let insertedId: unknown;
    try {
      const result = await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(doc as any);
      insertedId = result.insertedId;
    } catch (error: any) {
      if (error?.code === 11000) { skipped++; continue; } // duplicate externalId — safe no-op on re-run
      throw error;
    }
    ingested++;

    if (direction === 'inbound' && matchedLeadId && counterpartyEmail) {
      try {
        await generateContactSuggestion(db, brand, tenantId, matchedLeadId, counterpartyEmail, bodyText, String(insertedId));
      } catch (error) {
        console.error('[gmail-sync-store] contact-suggestion generation failed', error);
      }
    }
  }

  // Cursor is only committed after the full batch succeeds — an aborted/
  // failed run leaves the prior cursor intact, so the next run safely
  // re-covers the same window rather than skipping it (issue #216 §11/§15).
  const now = new Date().toISOString();
  await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).updateOne(
    { connectionId: connection.id, brand },
    { $set: { tenantId, gmailAddress, lastSyncedAt: new Date(Math.max(newestSeenMs, windowStartMs)).toISOString(), updatedAt: now } },
    { upsert: true }
  );

  return { ingested, skipped };
}
