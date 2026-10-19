import { ObjectId, type Db } from 'mongodb';
import {
  getActiveConnectionByProvider,
  listAllActiveUserConnections,
  listActiveUserConnections,
  getUserConnection,
  getValidCredential,
  ConnectionRevokedError,
} from './integration-store';
import type { IntegrationConnection } from '../../lib/integration-connections';
import { fetchWithRetry } from '../../lib/integration-http';
import {
  buildGmailExternalId, buildFallbackHash, participantsIntersectKnownEmails,
  resolveGmailDirection, resolveCounterpartyEmail,
} from '../../lib/gmail-sync';
import { matchReplyToLeads, findMatchedContact, generateContactSuggestion } from '../../lib/contact-reply-matching';
import { contactKey, normalizeEmail } from '../../lib/contacts';
import { ACTIVITY_LOG_COLLECTION, truncateBody, ensureActivityLogIndexes, type ActivityLogDocument } from './activity-log-store';
import { getBrandConfig, getAllBrandConfigs, type Brand } from './brand';
import { tenantFilter } from '../../lib/tenant';
import { deleteCalendarTaskReminder } from '../../lib/gcal-sync';
import { isMessageHistorical } from '../../lib/lead-timeline-filter';
import {
  extractContactsFromEmailMessage,
  cleanHtmlBody,
} from '../../lib/email-contact-extractor';
import { mergeContactsIntoLead } from '../../lib/email-contact-merge';

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
  return cleanHtmlBody(html);
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
  for (const header of ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References']) {
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

// Algorithm A (issue #216 §11, extended in #249 for multi-user sync) — polls a single
// Gmail connection (brand or user) once. Never fetches a message body until its headers
// already matched a known contact address (data-minimization, §17) — a rep's
// unrelated personal correspondence is never even fetched into this
// process, let alone stored.
export async function pollSingleGmailConnection(
  db: Db,
  connection: IntegrationConnection,
  brand: Brand,
  tenantId: string,
  brandConfig: NonNullable<Awaited<ReturnType<typeof getBrandConfig>>>,
  knownEmails: Set<string>
): Promise<GmailPollResult> {
  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch (error) {
    const reason = error instanceof ConnectionRevokedError ? error.message : 'token_unavailable';
    return { ingested: 0, skipped: 0, failure: reason };
  }

  await ensureGmailSyncCursorIndexes(db);
  await ensureActivityLogIndexes(db);

  const cursorDoc = await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).findOne({
    connectionId: connection.id,
    brand,
  }) as unknown as GmailSyncCursor | null;

  // Use stored userEmail if available (issue #247/249), or cache from Gmail profile.
  let gmailAddress = connection.userEmail || cursorDoc?.gmailAddress;
  if (!gmailAddress) {
    const profile = await fetchGmailProfile(token);
    if (!profile?.emailAddress) return { ingested: 0, skipped: 0, failure: 'profile_unavailable' };
    gmailAddress = profile.emailAddress;
  }

  const windowStartMs = cursorDoc ? new Date(cursorDoc.lastSyncedAt).getTime() : Date.now() - FIRST_SYNC_WINDOW_MS;

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
    const inReplyToHeader = getHeader(headers, 'In-Reply-To');
    const referencesHeader = getHeader(headers, 'References');

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
      ...(meta.threadId ? { threadId: meta.threadId } : {}),
      ...(messageIdHeader ? { rfcMessageId: messageIdHeader } : {}),
      ...(inReplyToHeader ? { inReplyTo: inReplyToHeader } : {}),
      ...(referencesHeader ? { references: referencesHeader } : {}),
    };

    let matchedLeadId: string | null = null;
    if (counterpartyEmail) {
      const match = await matchReplyToLeads(db, brand, tenantId, counterpartyEmail);
      if (match.kind === 'single-match') {
        matchedLeadId = match.leadId;
        doc.leadId = match.leadId;
        const contact = await findMatchedContact(db, brand, tenantId, match.leadId, counterpartyEmail);
        if (contact) doc.matchedContactKey = contactKey(contact);

        // Issue #244: Inspect lead creation timestamp to determine if email predates lead
        try {
          let leadObjId: ObjectId | null = null;
          try { leadObjId = new ObjectId(match.leadId); } catch {}
          if (leadObjId) {
            const leadDoc = await db.collection(brandConfig.dbCollection).findOne(
              { _id: leadObjId },
              { projection: { createdAt: 1 } }
            );
            if (leadDoc?.createdAt && isMessageHistorical(dateIso, leadDoc.createdAt)) {
              doc.isHistorical = true;
            }
          }
        } catch {
          // Non-fatal, default to non-historical
        }
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

    if (direction === 'inbound' && matchedLeadId) {
      if (counterpartyEmail) {
        try {
          await generateContactSuggestion(db, brand, tenantId, matchedLeadId, counterpartyEmail, bodyText, String(insertedId));
        } catch (error) {
          console.error('[gmail-sync-store] contact-suggestion generation failed', error);
        }
      }

      // Automatically harvest all external email participants and merge into lead.contacts
      try {
        const harvested = extractContactsFromEmailMessage(
          {
            from: fromEmail,
            to: toEmails,
            cc: ccEmails,
            body: bodyText,
          },
          { brand, internalEmails: [gmailAddress] }
        );
        if (harvested.length > 0) {
          await mergeContactsIntoLead(db, brand, tenantId, matchedLeadId, harvested);
        }
      } catch (harvestErr) {
        console.error('[gmail-sync-store] contact harvesting failed', harvestErr);
      }

      // Issue #249 / #244: Inbound prospect reply cancels active cadence sequence and future calendar reminders,
      // provided the message is NOT historical pre-lead correspondence (Issue #244).
      if (!doc.isHistorical) {
        try {
          let leadObjId: ObjectId | null = null;
          try { leadObjId = new ObjectId(matchedLeadId); } catch {}
          if (leadObjId) {
            const existingLead = await db.collection(brandConfig.dbCollection).findOne({ _id: leadObjId });
            if (existingLead?.activeCadence) {
              if (existingLead.activeCadence.taskStepId) {
                await deleteCalendarTaskReminder(db, {
                  brand,
                  tenantId,
                  taskId: existingLead.activeCadence.taskStepId,
                }).catch(() => {});
              }
              await db.collection(brandConfig.dbCollection).updateOne(
                { _id: leadObjId, activeCadence: { $ne: null } },
                {
                  $set: {
                    activeCadence: null,
                    nextActionDueAt: null,
                    nextActionNote: 'Sequence stopped: contact replied via Gmail',
                    updatedAt: new Date(),
                  },
                }
              );
            }
          }
        } catch (cancelError) {
          console.error('[gmail-sync-store] cadence auto-stop failed', cancelError);
        }
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

// Issue #216 / #249: Polls all active Gmail connections for a brand (including both
// brand-level and individual rep accounts).
export async function pollGmailForBrand(db: Db, brand: Brand, tenantId: string): Promise<GmailPollResult> {
  const brandConfig = await getBrandConfig(brand);
  if (!brandConfig) return { ingested: 0, skipped: 0, failure: 'unknown_brand' };

  // Issue #249: Retrieve brand connection and all active user connections
  const brandConn = await getActiveConnectionByProvider(db, brand, tenantId, 'gmail');
  const userConns = await listAllActiveUserConnections(db, 'gmail');

  const connectionMap = new Map<string, IntegrationConnection>();
  if (brandConn) connectionMap.set(brandConn.id, brandConn);
  for (const c of userConns) {
    connectionMap.set(c.id, c);
  }

  const connections = Array.from(connectionMap.values());
  if (connections.length === 0) return { ingested: 0, skipped: 0 };

  const leadsCollection = db.collection(brandConfig.dbCollection);
  const knownEmailDocs = await leadsCollection.find(tenantFilter(tenantId) as any, { projection: { contactEmails: 1 } }).toArray().catch(() => [] as any[]);
  const knownEmails = new Set<string>();
  for (const doc of knownEmailDocs) {
    for (const email of doc.contactEmails || []) knownEmails.add(normalizeEmail(email));
  }

  let totalIngested = 0;
  let totalSkipped = 0;
  const failureReasons: string[] = [];

  for (const connection of connections) {
    try {
      const res = await pollSingleGmailConnection(db, connection, brand, tenantId, brandConfig, knownEmails);
      totalIngested += res.ingested;
      totalSkipped += res.skipped;
      if (res.failure) failureReasons.push(res.failure);
    } catch (err: any) {
      failureReasons.push(err?.message || 'connection_poll_failed');
    }
  }

  return {
    ingested: totalIngested,
    skipped: totalSkipped,
    failure: failureReasons.length > 0 ? failureReasons.join('; ') : undefined,
  };
}

// Issue #249: Polls Gmail messages for a single user's connected Google account across
// Issue #249 / #252: Polls Gmail messages for all of a user's connected Google accounts
// across configured CRM brands (or a specific preferred brand/connection).
export async function pollUserGmail(
  db: Db,
  userId: string,
  targetBrand?: string,
  targetConnectionId?: string
): Promise<GmailPollResult> {
  const connections = targetConnectionId
    ? [await getUserConnection(db, userId, 'gmail', targetConnectionId)].filter((c): c is IntegrationConnection => Boolean(c && c.status === 'active'))
    : await listActiveUserConnections(db, userId, 'gmail');

  if (connections.length === 0) {
    return { ingested: 0, skipped: 0, failure: 'no_active_connection' };
  }

  const allBrandConfigs = await getAllBrandConfigs();
  const brandsToSync = targetBrand && allBrandConfigs[targetBrand]
    ? [targetBrand]
    : Object.keys(allBrandConfigs);

  let totalIngested = 0;
  let totalSkipped = 0;
  const failureReasons: string[] = [];

  for (const connection of connections) {
    for (const b of brandsToSync) {
      const brandConfig = allBrandConfigs[b];
      if (!brandConfig) continue;

      const tenantId = connection.tenantId || 'default';
      const leadsCollection = db.collection(brandConfig.dbCollection);
      const knownEmailDocs = await leadsCollection
        .find(tenantFilter(tenantId) as any, { projection: { contactEmails: 1 } })
        .toArray()
        .catch(() => [] as any[]);

      const knownEmails = new Set<string>();
      for (const doc of knownEmailDocs) {
        for (const email of doc.contactEmails || []) {
          knownEmails.add(normalizeEmail(email));
        }
      }

      try {
        const res = await pollSingleGmailConnection(db, connection, b as Brand, tenantId, brandConfig, knownEmails);
        totalIngested += res.ingested;
        totalSkipped += res.skipped;
        if (res.failure) failureReasons.push(res.failure);
      } catch (err: any) {
        failureReasons.push(err?.message || 'connection_poll_failed');
      }
    }
  }

  return {
    ingested: totalIngested,
    skipped: totalSkipped,
    failure: failureReasons.length > 0 ? failureReasons.join('; ') : undefined,
  };
}
