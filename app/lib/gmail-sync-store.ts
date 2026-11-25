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
  isInternalOrSystemEmail,
} from '../../lib/email-contact-extractor';
import { mergeContactsIntoLead } from '../../lib/email-contact-merge';
import { syncGmailConnectionSignatures } from '../../lib/gmail-signature';
import { getAccessibleBrands, isSuperAdminEmail } from '../../lib/sso-access';

export const GMAIL_SYNC_CURSORS_COLLECTION = 'gmailSyncCursors';

const FIRST_SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LIST_PAGE_SIZE = 250;
const MAX_LIST_PAGES_PER_POLL = 10; // up to 2,500 message IDs inspected chronologically per poll
const MAX_MESSAGES_PER_POLL = 150;
const SIGNATURE_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STALE_SYNC_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const CROSS_SOURCE_MATCH_WINDOW_MS = 2 * 60 * 1000; // ±2 minutes

export type GmailSyncCursor = {
  connectionId: string;
  brand: string;
  tenantId: string;
  gmailAddress?: string;
  lastSyncedAt: string;
  lastPolledAt?: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastIngestedCount?: number;
  lastSkippedCount?: number;
  updatedAt: string;
};

export type GmailSyncHealthState = 'up_to_date' | 'stale' | 'failed' | 'disconnected';

export type GmailSyncHealth = {
  state: GmailSyncHealthState;
  connectedEmail?: string;
  lastSuccessAt?: string | null;
  lastPolledAt?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  isStale: boolean;
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
  const emails: string[] = [];
  const regex = /(?:<([^\s<>@]+@[^\s<>@]+)>|([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const addr = (match[1] || match[2] || '').trim().toLowerCase();
    if (addr && addr.includes('@') && !emails.includes(addr)) {
      emails.push(addr);
    }
  }
  return emails;
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function fetchGmailProfile(token: string): Promise<{ emailAddress: string } | null> {
  const res = await fetchWithRetry(`${GMAIL_API_BASE}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}

async function listMessageIds(
  token: string,
  sinceMs: number
): Promise<{ ids: string[]; truncated: boolean; apiFailed: boolean }> {
  const collected: string[] = [];
  let pageToken: string | undefined;
  let hasMoreAfterMaxPages = false;

  for (let page = 0; page < MAX_LIST_PAGES_PER_POLL; page++) {
    const url = new URL(`${GMAIL_API_BASE}/messages`);
    url.searchParams.set('q', `after:${Math.floor(sinceMs / 1000)} -in:spam -in:trash -in:drafts`);
    url.searchParams.set('maxResults', String(MAX_LIST_PAGE_SIZE));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { ids: collected, truncated: false, apiFailed: collected.length === 0 };
    }
    const body = await res.json();
    const pageIds = Array.isArray(body.messages)
      ? body.messages.map((m: any) => m?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    for (const id of pageIds) {
      if (!collected.includes(id)) collected.push(id);
    }

    if (typeof body.nextPageToken === 'string' && body.nextPageToken.trim()) {
      pageToken = body.nextPageToken.trim();
      if (page === MAX_LIST_PAGES_PER_POLL - 1) {
        hasMoreAfterMaxPages = true;
      }
    } else {
      pageToken = undefined;
      break;
    }
  }

  // Gmail messages.list returns newest-first. Reverse into chronological oldest-to-newest order
  // so bounded batches advance the cursor cleanly from the prior sync point without skipping older gaps.
  collected.reverse();
  const truncated = hasMoreAfterMaxPages || collected.length > MAX_MESSAGES_PER_POLL;
  const ids = collected.slice(0, MAX_MESSAGES_PER_POLL);
  return { ids, truncated, apiFailed: false };
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

export type GmailAttachmentInfo = {
  filename: string;
  mimeType: string;
  size?: number;
  attachmentId: string;
  gmailMessageId?: string;
};

export function extractAttachments(payload: any, gmailMessageId?: string): GmailAttachmentInfo[] {
  const results: GmailAttachmentInfo[] = [];
  function walk(part: any) {
    if (!part) return;
    const filename = typeof part.filename === 'string' ? part.filename.trim() : '';
    const attachmentId = part.body?.attachmentId;
    if (filename && attachmentId) {
      results.push({
        filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: typeof part.body?.size === 'number' ? part.body.size : undefined,
        attachmentId: String(attachmentId),
        ...(gmailMessageId ? { gmailMessageId } : {}),
      });
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }
  walk(payload);
  return results;
}

async function getMessageFull(
  token: string,
  id: string
): Promise<{ bodyText?: string; attachments: GmailAttachmentInfo[] }> {
  const url = new URL(`${GMAIL_API_BASE}/messages/${id}`);
  url.searchParams.set('format', 'full');
  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { bodyText: undefined, attachments: [] };
  const body = await res.json();
  return {
    bodyText: extractBodyText(body.payload),
    attachments: extractAttachments(body.payload, id),
  };
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
  knownEmails: Set<string>,
  options: { forceSignatureSync?: boolean } = {}
): Promise<GmailPollResult> {
  await ensureGmailSyncCursorIndexes(db);
  await ensureActivityLogIndexes(db);

  const pollNowIso = new Date().toISOString();
  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch (error) {
    const reason = error instanceof ConnectionRevokedError ? error.message : 'token_unavailable';
    await db
      .collection(GMAIL_SYNC_CURSORS_COLLECTION)
      .updateOne(
        { connectionId: connection.id, brand },
        {
          $set: {
            tenantId,
            ...(connection.userEmail ? { gmailAddress: connection.userEmail } : {}),
            lastPolledAt: pollNowIso,
            lastError: reason,
            updatedAt: pollNowIso,
          },
          $setOnInsert: {
            lastSyncedAt: new Date(Date.now() - FIRST_SYNC_WINDOW_MS).toISOString(),
          },
        },
        { upsert: true }
      )
      .catch(() => {});
    return { ingested: 0, skipped: 0, failure: reason };
  }

  // Keep user sendAs signatures current automatically so compose/preview never stales
  if (connection.userId) {
    const sigAgeMs = connection.signatureSyncedAt
      ? Date.now() - new Date(connection.signatureSyncedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (options.forceSignatureSync || Number.isNaN(sigAgeMs) || sigAgeMs > SIGNATURE_REFRESH_INTERVAL_MS) {
      await syncGmailConnectionSignatures(db, connection, token).catch(() => {});
    }
  }

  const cursorDoc = await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).findOne({
    connectionId: connection.id,
    brand,
  }) as unknown as GmailSyncCursor | null;

  // Use stored userEmail if available (issue #247/249), or cache from Gmail profile.
  let gmailAddress = connection.userEmail || cursorDoc?.gmailAddress;
  if (!gmailAddress) {
    const profile = await fetchGmailProfile(token);
    if (!profile?.emailAddress) {
      await db
        .collection(GMAIL_SYNC_CURSORS_COLLECTION)
        .updateOne(
          { connectionId: connection.id, brand },
          {
            $set: {
              tenantId,
              lastPolledAt: pollNowIso,
              lastError: 'profile_unavailable',
              updatedAt: pollNowIso,
            },
            $setOnInsert: {
              lastSyncedAt: new Date(Date.now() - FIRST_SYNC_WINDOW_MS).toISOString(),
            },
          },
          { upsert: true }
        )
        .catch(() => {});
      return { ingested: 0, skipped: 0, failure: 'profile_unavailable' };
    }
    gmailAddress = profile.emailAddress;
  }

  const windowStartMs = cursorDoc?.lastSyncedAt
    ? new Date(cursorDoc.lastSyncedAt).getTime()
    : Date.now() - FIRST_SYNC_WINDOW_MS;

  const listed = await listMessageIds(token, windowStartMs);
  if (listed.apiFailed) {
    await db
      .collection(GMAIL_SYNC_CURSORS_COLLECTION)
      .updateOne(
        { connectionId: connection.id, brand },
        {
          $set: {
            tenantId,
            gmailAddress,
            lastPolledAt: pollNowIso,
            lastError: 'gmail_list_failed',
            updatedAt: pollNowIso,
          },
          $setOnInsert: {
            lastSyncedAt: new Date(windowStartMs).toISOString(),
          },
        },
        { upsert: true }
      )
      .catch(() => {});
    return { ingested: 0, skipped: 0, failure: 'gmail_list_failed' };
  }

  const messageIds = listed.ids;
  const isPersonalUserConnection = Boolean(connection.userId);
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
    const labelIds: string[] = Array.isArray(meta.labelIds) ? meta.labelIds : [];

    const parsedDateMs = dateHeader ? new Date(dateHeader).getTime() : Number.NaN;
    const internalDateMs = meta.internalDate ? Number(meta.internalDate) : Number.NaN;
    const resolvedMsgMs = !Number.isNaN(parsedDateMs)
      ? parsedDateMs
      : !Number.isNaN(internalDateMs)
        ? internalDateMs
        : Date.now();
    const dateIso = new Date(resolvedMsgMs).toISOString();

    // Always advance cursor past every inspected message so skipped internal/spam messages never freeze sync!
    newestSeenMs = Math.max(newestSeenMs, resolvedMsgMs);

    // Exclude unsent drafts, spam, and trash
    if (labelIds.includes('DRAFT') || labelIds.includes('SPAM') || labelIds.includes('TRASH')) {
      skipped++;
      continue;
    }

    const fromEmails = parseAddressList(fromRaw);
    const toEmails = parseAddressList(toRaw);
    const ccEmails = parseAddressList(ccRaw);
    const fromEmail = fromEmails[0] || '';
    const participantEmails = [fromEmail, ...toEmails, ...ccEmails].filter(Boolean);

    // Issue #268: Strictly ignore purely internal communications (between colleagues/internal bots)
    if (participantEmails.length === 0 || participantEmails.every((p) => isInternalOrSystemEmail(p, { brand }))) {
      skipped++;
      continue;
    }

    const direction = resolveGmailDirection(fromEmail, gmailAddress, brand);

    const isOutboundFromUser =
      Boolean(gmailAddress) &&
      normalizeEmail(fromEmail) === normalizeEmail(gmailAddress) &&
      direction === 'outbound';

    const matchesKnown = participantsIntersectKnownEmails(participantEmails, knownEmails);

    // Shared brand-level connections remain gated to known CRM contacts; personal user Gmail connections
    // sync the full connected Inbox/Sent stream so reps have a complete mailbox with CRM Lead badges.
    if (!isPersonalUserConnection && !matchesKnown && !isOutboundFromUser) {
      skipped++;
      continue;
    }

    const baseExternalId = messageIdHeader ? buildGmailExternalId(messageIdHeader) : `gmail:no-message-id:${messageId}`;
    const homeBrand = connection.brand || 'cogmap';
    const externalId = brand === homeBrand ? baseExternalId : `${baseExternalId}#${brand}`;

    const existingByExternalId = await db.collection(ACTIVITY_LOG_COLLECTION).findOne({ externalId });
    if (existingByExternalId) { skipped++; continue; }

    const fallbackHash = buildFallbackHash({ from: fromEmail, toCc: [...toEmails, ...ccEmails], subject, dateIso });
    const windowStart = new Date(new Date(dateIso).getTime() - CROSS_SOURCE_MATCH_WINDOW_MS);
    const windowEnd = new Date(new Date(dateIso).getTime() + CROSS_SOURCE_MATCH_WINDOW_MS);
    const existingByHash = await db.collection(ACTIVITY_LOG_COLLECTION).findOne({
      brand, source: { $in: ['inbound-webhook', 'gmail-sync'] }, fallbackHash, createdAt: { $gte: windowStart, $lte: windowEnd },
    });
    if (existingByHash) { skipped++; continue; }

    const counterpartyEmail = resolveCounterpartyEmail(direction, fromEmail, [...toEmails, ...ccEmails], knownEmails, brand);

    const internalSender = fromEmail && isInternalOrSystemEmail(fromEmail, { brand }) ? normalizeEmail(fromEmail) : null;
    const docUserEmail = internalSender || connection.userEmail || gmailAddress;
    const gmailUnread = labelIds.length > 0 ? labelIds.includes('UNREAD') : undefined;

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
      userId: (internalSender && internalSender !== normalizeEmail(connection.userEmail || '')) ? undefined : connection.userId,
      userEmail: docUserEmail,
      connectionId: connection.id,
      ...(typeof gmailUnread === 'boolean' ? { gmailUnread } : {}),
      ...(matchesKnown ? { isCrmMatched: true } : {}),
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
        doc.isCrmMatched = true;
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
        doc.isCrmMatched = true;
      }
    }

    // Body is fetched only now — after every cheap, header-only gate
    // above already passed — matching the data-minimization requirement.
    const { bodyText, attachments } = await getMessageFull(token, messageId);
    doc.bodyExcerpt = truncateBody(bodyText);
    doc.gmailMessageId = messageId;
    if (attachments.length > 0) {
      doc.attachments = attachments;
    }

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
  const nextCursorMs = listed.truncated
    ? Math.max(newestSeenMs, windowStartMs)
    : Math.max(newestSeenMs, windowStartMs, messageIds.length === 0 ? Date.now() - 60_000 : newestSeenMs);
  await db.collection(GMAIL_SYNC_CURSORS_COLLECTION).updateOne(
    { connectionId: connection.id, brand },
    {
      $set: {
        tenantId,
        gmailAddress,
        lastSyncedAt: new Date(nextCursorMs).toISOString(),
        lastPolledAt: now,
        lastSuccessAt: now,
        lastError: null,
        lastIngestedCount: ingested,
        lastSkippedCount: skipped,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  return { ingested, skipped };
}

async function collectKnownBrandEmails(
  db: Db,
  brand: Brand,
  tenantId: string,
  leadsCollectionName: string
): Promise<Set<string>> {
  const knownEmails = new Set<string>();
  const leadsCollection = db.collection(leadsCollectionName);
  const docs = await leadsCollection
    .find(tenantFilter(tenantId) as any, {
      projection: { contactEmails: 1, contacts: 1, general_contact: 1, decision_maker_contact: 1 },
    })
    .toArray()
    .catch(() => [] as any[]);

  for (const doc of docs) {
    if (Array.isArray(doc.contactEmails)) {
      for (const email of doc.contactEmails) {
        const norm = normalizeEmail(email);
        if (norm && !isInternalOrSystemEmail(norm, { brand })) {
          knownEmails.add(norm);
        }
      }
    }
    if (Array.isArray(doc.contacts)) {
      for (const c of doc.contacts) {
        if (c && c.email) {
          const norm = normalizeEmail(c.email);
          if (norm && !isInternalOrSystemEmail(norm, { brand })) {
            knownEmails.add(norm);
          }
        }
      }
    }
    for (const field of [doc.general_contact, doc.decision_maker_contact]) {
      if (typeof field === 'string' && field.includes('@')) {
        for (const e of parseAddressList(field)) {
          const norm = normalizeEmail(e);
          if (norm && !isInternalOrSystemEmail(norm, { brand })) {
            knownEmails.add(norm);
          }
        }
      }
    }
  }

  const outreachDocs = await db.collection('outreach_logs')
    .find({ brand, ...(tenantId ? { tenantId } : {}) }, { projection: { to: 1 } })
    .toArray()
    .catch(() => [] as any[]);
  for (const o of outreachDocs) {
    for (const e of parseAddressList(o.to)) {
      const norm = normalizeEmail(e);
      if (norm && !isInternalOrSystemEmail(norm, { brand })) {
        knownEmails.add(norm);
      }
    }
  }

  return knownEmails;
}

async function resolveAllowedBrandsForUserConnection(
  db: Db,
  connection: IntegrationConnection,
  allBrands: string[]
): Promise<Set<string>> {
  if (!connection.userId) {
    return new Set([connection.brand]);
  }
  if (connection.userEmail && isSuperAdminEmail(connection.userEmail)) {
    return new Set(allBrands);
  }
  try {
    const accessDoc = await db.collection('sso_user_access').findOne({ ssoUserId: connection.userId });
    if (accessDoc) {
      const email = typeof accessDoc.email === 'string' ? accessDoc.email : connection.userEmail;
      const brands = getAccessibleBrands(email, accessDoc.orgAccess, allBrands);
      if (brands.length > 0) {
        return new Set(brands);
      }
    }
  } catch {
    // Fall back to connection's home brand below
  }
  return new Set([connection.brand || 'cogmap']);
}

export async function getGmailSyncHealth(
  db: Db,
  brand: string,
  tenantId: string,
  options: { userId?: string; userEmail?: string } = {}
): Promise<GmailSyncHealth> {
  try {
    let connections: IntegrationConnection[] = [];
    if (options.userId) {
      connections = await listActiveUserConnections(db, options.userId, 'gmail');
      if (connections.length === 0) {
        // Check if user has a non-active (expired/error) connection so we distinguish failed vs disconnected
        const anyUserConns = await db
          .collection('integration_connections')
          .find({
            provider: 'gmail',
            status: { $ne: 'revoked' },
            $or: [
              { userId: options.userId },
              ...(options.userEmail ? [{ userEmail: options.userEmail.toLowerCase().trim() }] : []),
            ],
          })
          .toArray()
          .catch(() => []);
        if (anyUserConns.length > 0) {
          const broken = anyUserConns[0] as any;
          return {
            state: 'failed',
            connectedEmail: broken.userEmail || broken.providerAccountLabel,
            lastSuccessAt: null,
            lastPolledAt: broken.updatedAt || null,
            lastSyncedAt: null,
            lastError: broken.lastSyncError || `connection_${broken.status || 'inactive'}`,
            isStale: true,
          };
        }
      }
    } else {
      const brandConn = await getActiveConnectionByProvider(db, brand, tenantId, 'gmail');
      if (brandConn) connections = [brandConn];
    }

    if (connections.length === 0) {
      return {
        state: 'disconnected',
        lastSuccessAt: null,
        lastPolledAt: null,
        lastSyncedAt: null,
        lastError: null,
        isStale: false,
      };
    }

    const primary = connections.find((c) => c.isDefault) || connections[0];
    const cursorDoc = (await db
      .collection(GMAIL_SYNC_CURSORS_COLLECTION)
      .findOne({ connectionId: primary.id, brand })
      .catch(() => null)) as GmailSyncCursor | null;

    const lastSuccessAt = cursorDoc?.lastSuccessAt || cursorDoc?.lastSyncedAt || null;
    const lastPolledAt = cursorDoc?.lastPolledAt || cursorDoc?.updatedAt || null;
    const lastError = cursorDoc?.lastError || primary.lastSyncError || null;
    const ageMs = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() : Number.POSITIVE_INFINITY;
    const isStale = Number.isNaN(ageMs) || ageMs > STALE_SYNC_THRESHOLD_MS;

    if (lastError) {
      return {
        state: 'failed',
        connectedEmail: primary.userEmail || cursorDoc?.gmailAddress || primary.providerAccountLabel,
        lastSuccessAt,
        lastPolledAt,
        lastSyncedAt: cursorDoc?.lastSyncedAt || null,
        lastError,
        isStale: true,
      };
    }

    return {
      state: isStale ? 'stale' : 'up_to_date',
      connectedEmail: primary.userEmail || cursorDoc?.gmailAddress || primary.providerAccountLabel,
      lastSuccessAt,
      lastPolledAt,
      lastSyncedAt: cursorDoc?.lastSyncedAt || null,
      lastError: null,
      isStale,
    };
  } catch {
    return {
      state: 'disconnected',
      lastSuccessAt: null,
      lastPolledAt: null,
      lastSyncedAt: null,
      lastError: null,
      isStale: false,
    };
  }
}

// Issue #216 / #249 / #357: Polls active Gmail connections authorized for this brand.
export async function pollGmailForBrand(db: Db, brand: Brand, tenantId: string): Promise<GmailPollResult> {
  const brandConfig = await getBrandConfig(brand);
  if (!brandConfig) return { ingested: 0, skipped: 0, failure: 'unknown_brand' };

  const allBrandKeys = Object.keys(await getAllBrandConfigs());
  const brandConn = await getActiveConnectionByProvider(db, brand, tenantId, 'gmail');
  const userConns = await listAllActiveUserConnections(db, 'gmail');

  const connectionMap = new Map<string, IntegrationConnection>();
  if (brandConn) connectionMap.set(brandConn.id, brandConn);
  for (const c of userConns) {
    const allowed = await resolveAllowedBrandsForUserConnection(db, c, allBrandKeys);
    if (allowed.has(brand)) {
      connectionMap.set(c.id, c);
    }
  }

  const connections = Array.from(connectionMap.values());
  if (connections.length === 0) return { ingested: 0, skipped: 0 };

  const knownEmails = await collectKnownBrandEmails(db, brand, tenantId, brandConfig.dbCollection);

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

// Issue #249 / #252 / #357: Polls Gmail messages for a user's connected Google account(s)
// across their accessible CRM brands (or a specific requested brand/connection) and refreshes signatures.
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
  const allBrandKeys = Object.keys(allBrandConfigs);

  let totalIngested = 0;
  let totalSkipped = 0;
  const failureReasons: string[] = [];

  for (const connection of connections) {
    const allowedBrands = await resolveAllowedBrandsForUserConnection(db, connection, allBrandKeys);
    const brandsToSync =
      targetBrand && allBrandConfigs[targetBrand]
        ? [targetBrand]
        : Array.from(allowedBrands).filter((b) => Boolean(allBrandConfigs[b]));

    let syncedSigOnce = false;
    for (const b of brandsToSync) {
      const brandConfig = allBrandConfigs[b];
      if (!brandConfig) continue;

      const tenantId = connection.tenantId || 'default';
      const knownEmails = await collectKnownBrandEmails(db, b as Brand, tenantId, brandConfig.dbCollection);

      try {
        const res = await pollSingleGmailConnection(db, connection, b as Brand, tenantId, brandConfig, knownEmails, {
          forceSignatureSync: !syncedSigOnce,
        });
        syncedSigOnce = true;
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
