import type { Db } from 'mongodb';
import {
  listActiveUserConnections,
  getUserConnection,
  getValidCredential,
} from '../app/lib/integration-store';
import type { IntegrationConnection } from './integration-connections';
import { fetchWithRetry } from './integration-http';
import { cleanHtmlBody, cleanMessageSnippet, isInternalOrSystemEmail } from './email-contact-extractor';
import { buildRfc2822Message, encodeBase64Url, sendGmailMessage } from './gmail-send';
import { appendSignatureToBody, resolveSignatureForSender } from './gmail-signature';
import { buildGmailExternalId } from './gmail-sync';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '../app/lib/activity-log-store';
import { getBrandConfig } from '../app/lib/brand';

export const GMAIL_DRAFT_DISPATCHES_COLLECTION = 'gmail_draft_dispatches';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_DRAFTS_PER_CONNECTION = 25;

export type GmailDraftItem = {
  draftId: string;
  messageId: string;
  threadId?: string;
  connectionId: string;
  senderEmail: string;
  fromHeader?: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  snippet: string;
  updatedAt: string;
  inReplyTo?: string;
  references?: string;
  rfcMessageId?: string;
  // CRM & Thread Matching (#08)
  matchedLeadId?: string;
  matchedLeadName?: string;
  matchedContactName?: string;
  matchedContactEmail?: string;
  matchedThreadId?: string;
  isCrmLead: boolean;
};

let draftIndexesEnsured = false;
export async function ensureGmailDraftIndexes(db: Db): Promise<void> {
  if (draftIndexesEnsured) return;
  try {
    const col = db.collection(GMAIL_DRAFT_DISPATCHES_COLLECTION);
    if (typeof col?.createIndex === 'function') {
      await col.createIndex({ connectionId: 1, draftId: 1 }, { unique: true });
    }
    draftIndexesEnsured = true;
  } catch {
    // non-fatal
  }
}

function decodeBase64UrlText(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function extractDraftBodyText(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64UrlText(payload.body.data).trim();
  }
  if (Array.isArray(payload.parts)) {
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain' && p.body?.data);
    if (plain) return decodeBase64UrlText(plain.body.data).trim();
    for (const part of payload.parts) {
      const nested = extractDraftBodyText(part);
      if (nested) return nested;
    }
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (html) return cleanHtmlBody(decodeBase64UrlText(html.body.data)).trim();
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return cleanHtmlBody(decodeBase64UrlText(payload.body.data)).trim();
  }
  return '';
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  const match = (headers || []).find((h) => h?.name?.toLowerCase() === name.toLowerCase());
  return match?.value;
}

export function parseHeaderEmails(value: string | undefined): string[] {
  if (!value) return [];
  const emails: string[] = [];
  const regex =
    /(?:<([^\s<>@]+@[^\s<>@]+)>|([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const addr = (match[1] || match[2] || '').trim().toLowerCase();
    if (addr && addr.includes('@') && !emails.includes(addr)) {
      emails.push(addr);
    }
  }
  return emails;
}

function hasComposeScope(connection: Pick<IntegrationConnection, 'scopes'>): boolean {
  const scopes = connection.scopes || [];
  return scopes.some(
    (s) =>
      s.includes('gmail.compose') ||
      s.includes('gmail.modify') ||
      s === 'https://mail.google.com/'
  );
}

export async function listUserGmailDrafts(
  db: Db,
  brand: string,
  tenantId: string,
  userContext: { userId?: string; userEmail?: string }
): Promise<{ connected: boolean; drafts: GmailDraftItem[]; errors?: string[] }> {
  if (!userContext.userId) {
    return { connected: false, drafts: [] };
  }

  await ensureGmailDraftIndexes(db);
  const connections = await listActiveUserConnections(db, userContext.userId, 'gmail');
  if (connections.length === 0) {
    return { connected: false, drafts: [] };
  }

  const dispatchedDocs = await db
    .collection(GMAIL_DRAFT_DISPATCHES_COLLECTION)
    .find({ connectionId: { $in: connections.map((c) => c.id) } }, { projection: { connectionId: 1, draftId: 1 } })
    .toArray()
    .catch(() => []);
  const sentDraftKeys = new Set(dispatchedDocs.map((d: any) => `${d.connectionId}:${d.draftId}`));

  const rawDrafts: GmailDraftItem[] = [];
  const errors: string[] = [];

  for (const conn of connections) {
    let token: string;
    try {
      token = await getValidCredential(db, conn);
    } catch (err: any) {
      errors.push(err?.message || 'token_unavailable');
      continue;
    }

    const listUrl = `${GMAIL_API_BASE}/drafts?maxResults=${MAX_DRAFTS_PER_CONNECTION}`;
    const listRes = await fetchWithRetry(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!listRes.ok) {
      errors.push(`drafts_list_${listRes.status}`);
      continue;
    }
    const listBody = await listRes.json().catch(() => ({}));
    const draftStubs: Array<{ id: string }> = Array.isArray(listBody.drafts) ? listBody.drafts : [];

    for (const stub of draftStubs) {
      if (!stub?.id || sentDraftKeys.has(`${conn.id}:${stub.id}`)) continue;
      const detailRes = await fetchWithRetry(
        `${GMAIL_API_BASE}/drafts/${encodeURIComponent(stub.id)}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!detailRes.ok) continue;
      const detail = await detailRes.json().catch(() => null);
      const msg = detail?.message;
      if (!msg) continue;

      const headers = msg.payload?.headers || [];
      const fromHeader = getHeader(headers, 'From');
      const to = parseHeaderEmails(getHeader(headers, 'To'));
      const cc = parseHeaderEmails(getHeader(headers, 'Cc'));
      const subject = (getHeader(headers, 'Subject') || '').trim();
      const dateHeader = getHeader(headers, 'Date');
      const rfcMessageId = getHeader(headers, 'Message-ID');
      const inReplyTo = getHeader(headers, 'In-Reply-To');
      const references = getHeader(headers, 'References');
      const bodyText = extractDraftBodyText(msg.payload);
      const fromParsed = parseHeaderEmails(fromHeader)[0];
      const senderEmail = fromParsed || (conn.userEmail || conn.providerAccountLabel || '').trim().toLowerCase();

      const internalDateMs = msg.internalDate ? Number(msg.internalDate) : Number.NaN;
      const dateHeaderMs = dateHeader ? new Date(dateHeader).getTime() : Number.NaN;
      const updatedAt = !Number.isNaN(internalDateMs)
        ? new Date(internalDateMs).toISOString()
        : !Number.isNaN(dateHeaderMs)
          ? new Date(dateHeaderMs).toISOString()
          : new Date().toISOString();

      rawDrafts.push({
        draftId: String(stub.id),
        messageId: String(msg.id || stub.id),
        ...(msg.threadId ? { threadId: String(msg.threadId) } : {}),
        connectionId: conn.id,
        senderEmail,
        ...(fromHeader ? { fromHeader } : {}),
        to,
        cc,
        subject: subject || '(No subject)',
        bodyText,
        snippet: cleanMessageSnippet(bodyText || msg.snippet || '', 140),
        updatedAt,
        ...(inReplyTo ? { inReplyTo } : {}),
        ...(references ? { references } : {}),
        ...(rfcMessageId ? { rfcMessageId } : {}),
        isCrmLead: false,
      });
    }
  }

  if (rawDrafts.length === 0) {
    return {
      connected: true,
      drafts: [],
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  // Batch-match recipients against workspace CRM leads and existing Inbox threads
  const candidateEmails = new Set<string>();
  const candidateThreadIds = new Set<string>();
  for (const d of rawDrafts) {
    for (const addr of [...d.to, ...d.cc]) {
      if (addr && !isInternalOrSystemEmail(addr, { brand })) {
        candidateEmails.add(addr);
      }
    }
    if (d.threadId) candidateThreadIds.add(d.threadId);
  }

  const brandConfig = await getBrandConfig(brand).catch(() => null);
  const leadsColName = brandConfig?.dbCollection || 'leads';

  const [leadDocs, existingThreadDocs] = await Promise.all([
    candidateEmails.size > 0
      ? db
          .collection(leadsColName)
          .find(
            {
              ...(tenantId ? { tenantId } : {}),
              $or: [
                { contactEmails: { $in: Array.from(candidateEmails) } },
                { 'contacts.email': { $in: Array.from(candidateEmails) } },
              ],
            },
            { projection: { _id: 1, id: 1, entity_name: 1, name: 1, contacts: 1, contactEmails: 1 } }
          )
          .toArray()
          .catch(() => [])
      : Promise.resolve([]),
    candidateThreadIds.size > 0
      ? db
          .collection(ACTIVITY_LOG_COLLECTION)
          .find(
            {
              brand,
              ...(tenantId ? { tenantId } : {}),
              threadId: { $in: Array.from(candidateThreadIds) },
            },
            { projection: { threadId: 1, leadId: 1 } }
          )
          .toArray()
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const leadByEmail = new Map<string, { leadId: string; leadName: string; contactName?: string; contactEmail: string }>();
  for (const lead of leadDocs) {
    const leadId = lead._id ? lead._id.toString() : String(lead.id || '');
    const leadName = lead.entity_name || lead.name || 'CRM Lead';
    if (Array.isArray(lead.contacts)) {
      for (const c of lead.contacts) {
        const cEmail = typeof c?.email === 'string' ? c.email.trim().toLowerCase() : '';
        if (cEmail && !leadByEmail.has(cEmail)) {
          leadByEmail.set(cEmail, {
            leadId,
            leadName,
            contactName: c.name || undefined,
            contactEmail: cEmail,
          });
        }
      }
    }
    if (Array.isArray(lead.contactEmails)) {
      for (const ce of lead.contactEmails) {
        const norm = typeof ce === 'string' ? ce.trim().toLowerCase() : '';
        if (norm && !leadByEmail.has(norm)) {
          leadByEmail.set(norm, { leadId, leadName, contactEmail: norm });
        }
      }
    }
  }

  const knownInboxThreads = new Set<string>(
    existingThreadDocs.map((t: any) => String(t.threadId || '')).filter(Boolean)
  );

  for (const draft of rawDrafts) {
    const externalRecipients = [...draft.to, ...draft.cc].filter((e) => !isInternalOrSystemEmail(e, { brand }));
    for (const email of externalRecipients) {
      const matched = leadByEmail.get(email);
      if (matched) {
        draft.matchedLeadId = matched.leadId;
        draft.matchedLeadName = matched.leadName;
        draft.matchedContactName = matched.contactName;
        draft.matchedContactEmail = matched.contactEmail;
        draft.isCrmLead = true;
        break;
      }
    }
    if (draft.threadId && knownInboxThreads.has(draft.threadId)) {
      draft.matchedThreadId = draft.threadId;
    }
  }

  rawDrafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return {
    connected: true,
    drafts: rawDrafts,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export type SendGmailDraftParams = {
  draftId: string;
  connectionId: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  unchanged?: boolean;
  includeSignature?: boolean;
  senderEmail?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  matchedLeadId?: string;
};

export async function sendUserGmailDraft(
  db: Db,
  brand: string,
  tenantId: string,
  params: SendGmailDraftParams,
  userContext: { userId?: string; userEmail?: string; userName?: string }
): Promise<{
  ok: boolean;
  sentMessageId?: string;
  threadId?: string;
  leadId?: string | null;
  error?: string;
}> {
  if (!userContext.userId) {
    return { ok: false, error: 'Not authenticated' };
  }
  const draftId = (params.draftId || '').trim();
  const connectionId = (params.connectionId || '').trim();
  if (!draftId || !connectionId) {
    return { ok: false, error: 'draftId and connectionId are required' };
  }

  const toList = (Array.isArray(params.to) ? params.to : parseHeaderEmails(params.to))
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  const ccList = (Array.isArray(params.cc) ? params.cc : parseHeaderEmails(params.cc))
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));

  if (toList.length === 0) {
    return { ok: false, error: 'At least one valid recipient email address is required' };
  }
  const subject = (params.subject || '').trim();
  if (!subject) {
    return { ok: false, error: 'Subject is required' };
  }
  const rawBody = (params.body || '').trim();
  if (!rawBody) {
    return { ok: false, error: 'Message body cannot be empty' };
  }

  await ensureGmailDraftIndexes(db);
  const alreadyDispatched = await db
    .collection(GMAIL_DRAFT_DISPATCHES_COLLECTION)
    .findOne({ connectionId, draftId });
  if (alreadyDispatched) {
    return {
      ok: true,
      sentMessageId: alreadyDispatched.sentMessageId,
      threadId: alreadyDispatched.threadId,
      leadId: alreadyDispatched.leadId ?? null,
    };
  }

  const connection = await getUserConnection(db, userContext.userId, 'gmail', connectionId);
  if (!connection || connection.status !== 'active') {
    return { ok: false, error: 'Selected Gmail connection is not active' };
  }

  let accessToken: string;
  try {
    accessToken = await getValidCredential(db, connection);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Gmail credentials unavailable' };
  }

  const senderIdentity = resolveSignatureForSender(connection, params.senderEmail || connection.userEmail);
  const fromAddress =
    senderIdentity.fromEmail || params.senderEmail || connection.userEmail || userContext.userEmail || 'me';
  const deliveredBody =
    params.includeSignature !== false && senderIdentity.signatureText
      ? appendSignatureToBody(rawBody, senderIdentity.signatureText)
      : rawBody;

  const { messageText, messageId: generatedRfcId } = buildRfc2822Message({
    from: { name: senderIdentity.displayName || userContext.userName, email: fromAddress },
    to: { email: toList[0] },
    subject,
    bodyText: deliveredBody,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });

  // Add secondary To / Cc headers into RFC 2822 message when multiple recipients exist
  let finalMime = messageText;
  if (toList.length > 1 || ccList.length > 0) {
    const lines = messageText.split('\r\n');
    const toIdx = lines.findIndex((l) => l.startsWith('To: '));
    if (toIdx >= 0 && toList.length > 1) {
      lines[toIdx] = `To: ${toList.join(', ')}`;
    }
    if (ccList.length > 0 && toIdx >= 0) {
      lines.splice(toIdx + 1, 0, `Cc: ${ccList.join(', ')}`);
    }
    finalMime = lines.join('\r\n');
  }

  let sentMessageId = '';
  let resolvedThreadId = params.threadId;

  const canUseDraftsSend = hasComposeScope(connection);
  if (canUseDraftsSend) {
    try {
      if (params.unchanged && deliveredBody === rawBody) {
        const sendRes = await fetchWithRetry(`${GMAIL_API_BASE}/drafts/send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: draftId }),
        });
        if (sendRes.ok) {
          const data = await sendRes.json();
          sentMessageId = data.id;
          resolvedThreadId = data.threadId || resolvedThreadId;
        }
      }

      if (!sentMessageId) {
        // Update draft with edited content, then send via drafts.send so Gmail removes it from Drafts
        const rawEncoded = encodeBase64Url(finalMime);
        const updateRes = await fetchWithRetry(
          `${GMAIL_API_BASE}/drafts/${encodeURIComponent(draftId)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: draftId,
              message: {
                raw: rawEncoded,
                ...(params.threadId ? { threadId: params.threadId } : {}),
              },
            }),
          }
        );
        if (updateRes.ok) {
          const sendRes = await fetchWithRetry(`${GMAIL_API_BASE}/drafts/send`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id: draftId }),
          });
          if (sendRes.ok) {
            const data = await sendRes.json();
            sentMessageId = data.id;
            resolvedThreadId = data.threadId || resolvedThreadId;
          }
        }
      }
    } catch {
      // Fall back to direct messages.send below
    }
  }

  if (!sentMessageId) {
    try {
      const gmailResult = await sendGmailMessage({
        accessToken,
        rawMime: finalMime,
        threadId: params.threadId,
      });
      sentMessageId = gmailResult.id;
      resolvedThreadId = gmailResult.threadId || resolvedThreadId;
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to send draft through Gmail' };
    }
  }

  // Match to CRM lead if not explicitly passed
  let leadId: string | null = params.matchedLeadId?.trim() || null;
  if (!leadId) {
    const brandConfig = await getBrandConfig(brand).catch(() => null);
    const leadsCol = brandConfig?.dbCollection || 'leads';
    const externalRecipients = [...toList, ...ccList].filter((e) => !isInternalOrSystemEmail(e, { brand }));
    if (externalRecipients.length > 0) {
      const matchedLead = await db
        .collection(leadsCol)
        .findOne(
          {
            ...(tenantId ? { tenantId } : {}),
            $or: [
              { contactEmails: { $in: externalRecipients } },
              { 'contacts.email': { $in: externalRecipients } },
            ],
          },
          { projection: { _id: 1, id: 1 } }
        )
        .catch(() => null);
      if (matchedLead) {
        leadId = matchedLead._id ? matchedLead._id.toString() : String(matchedLead.id || '');
      }
    }
  }

  const now = new Date();
  const externalId = buildGmailExternalId(generatedRfcId);

  // Record sent message exactly once in activityLog (using RFC Message-ID externalId so later Gmail sync dedupes!)
  await ensureActivityLogIndexes(db);
  await db
    .collection(ACTIVITY_LOG_COLLECTION)
    .insertOne({
      leadId,
      tenantId,
      brand,
      type: 'email-outbound',
      direction: 'outbound',
      fromAddress,
      toAddresses: toList,
      ...(ccList.length > 0 ? { ccAddresses: ccList } : {}),
      subject,
      bodyExcerpt: truncateBody(deliveredBody),
      matchedContactKey: null,
      source: 'manual',
      externalId,
      gmailMessageId: sentMessageId,
      ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      rfcMessageId: generatedRfcId,
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references ? { references: params.references } : {}),
      userId: userContext.userId,
      userEmail: connection.userEmail || userContext.userEmail,
      connectionId: connection.id,
      ...(leadId ? { isCrmMatched: true } : {}),
      createdAt: now,
    })
    .catch((err: any) => {
      if (err?.code !== 11000) {
        console.error('[gmail-drafts] activityLog write error:', err);
      }
    });

  if (leadId) {
    await db
      .collection('outreach_logs')
      .insertOne({
        tenantId,
        leadId,
        brand,
        to: toList[0],
        channel: 'email',
        subject,
        body: deliveredBody,
        routingAllowed: true,
        routingReason: null,
        sendAttempted: true,
        gmailMessageId: sentMessageId,
        gmailThreadId: resolvedThreadId,
        rfcMessageId: generatedRfcId,
        ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
        ...(params.references ? { references: params.references } : {}),
        source: 'gmail',
        from: fromAddress,
        senderUserId: userContext.userId,
        sentAutomatically: false,
        activityLogWritten: true,
        createdAt: now,
      })
      .catch(() => {});
  }

  await db
    .collection(GMAIL_DRAFT_DISPATCHES_COLLECTION)
    .updateOne(
      { connectionId, draftId },
      {
        $set: {
          brand,
          tenantId,
          userId: userContext.userId,
          sentMessageId,
          threadId: resolvedThreadId,
          leadId,
          sentAt: now.toISOString(),
        },
      },
      { upsert: true }
    )
    .catch(() => {});

  return {
    ok: true,
    sentMessageId,
    threadId: resolvedThreadId,
    leadId,
  };
}
