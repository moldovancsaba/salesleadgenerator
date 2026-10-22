import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { ACTIVITY_LOG_COLLECTION, truncateBody, ensureActivityLogIndexes } from './activity-log-store';
import { getBrandConfig } from './brand';
import { sendManualEmail, type LeadForSend, type AutomatedSendResult } from '../../lib/outreach-send';
import { formatReSubject, resolveLeadThreadContext } from '../../lib/gmail-threading';
import type { OutreachTemplate } from './outreach/default-templates';
import {
  extractContactsFromEmailMessage,
  cleanHtmlBody,
  cleanMessageSnippet,
  parseEmailParticipant,
  formatLocalPartAsName,
  isInternalOrSystemEmail,
  COMMON_PUBLIC_MAIL_DOMAINS,
} from '../../lib/email-contact-extractor';
import { mergeContactsIntoLead } from '../../lib/email-contact-merge';
import type { NormalizedContact } from '../../lib/contacts';
import { getUserAliases, KNOWN_USER_ALIASES } from '../../lib/sso-access';

export const INBOX_THREAD_STATES_COLLECTION = 'inbox_thread_states';

export { KNOWN_USER_ALIASES };

export type InboxStream = 'all' | 'inbox' | 'sent' | 'needs_reply' | 'internal' | 'calls' | 'system';

export interface InboxThreadState {
  brand: string;
  tenantId: string;
  threadId: string;
  userId?: string;
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  updatedAt: string;
}

export interface InboxMessage {
  id: string;
  threadId: string;
  leadId: string;
  type: 'email-inbound' | 'email-outbound' | 'note' | 'call' | 'system' | 'meeting-scheduled';
  direction: 'inbound' | 'outbound' | null;
  subject?: string;
  body: string;
  from?: string;
  to?: string[];
  cc?: string[];
  createdAt: string;
  source: string;
  callDisposition?: string;
  callDurationMinutes?: number;
  loggedBy?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  emailStatus?: string;
  openCount?: number;
  clickCount?: number;
  // Mailbox & user attribution (Issue 268)
  userId?: string;
  userEmail?: string;
  connectionId?: string;
}

export interface InboxThread {
  id: string;
  leadId: string;
  leadName: string;
  leadStage?: string;
  contactName?: string;
  contactEmail?: string;
  dealValue?: number;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  lastMessageType: 'email-inbound' | 'email-outbound' | 'note' | 'call' | 'system' | 'meeting-scheduled';
  lastMessageDirection: 'inbound' | 'outbound' | null;
  messageCount: number;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  needsReply: boolean;
  senderDisplayName?: string;
  senderEmail?: string;
  hasLead: boolean;
  hasContact: boolean;
  hasDeal: boolean;
  dealsCount?: number;
  contactsCount?: number;
  streams: InboxStream[];
  participants?: NormalizedContact[];
  // Mailbox scoping & ownership (Issue 268)
  isMyInbox?: boolean;
  userMailbox?: string;
}

export interface InboxCounts {
  all: number;
  inbox: number;
  sent: number;
  needs_reply: number;
  internal: number;
  calls: number;
  system: number;
  unread: number;
}

export interface InboxMailboxOption {
  email: string;
  label: string;
  count: number;
}

export interface InboxListOptions {
  stream?: InboxStream;
  search?: string;
  starredOnly?: boolean;
  unreadOnly?: boolean;
  archivedOnly?: boolean;
  userId?: string;
  userEmail?: string;
  scope?: 'my' | 'team';
  mailbox?: string;
  limit?: number;
  offset?: number;
}

let inboxIndexesEnsured = false;
export async function ensureInboxIndexes(db: Db): Promise<void> {
  if (inboxIndexesEnsured) return;
  try {
    const col = db.collection(INBOX_THREAD_STATES_COLLECTION);
    await col.createIndex({ brand: 1, tenantId: 1, threadId: 1 }, { background: true });
    inboxIndexesEnsured = true;
  } catch (err) {
    console.warn('[inbox-store] index creation warning:', err);
  }
}

/**
 * Extracts a robust cluster thread identifier from an activityLog or outreach_logs document.
 */
function resolveMessageThreadId(doc: any): string {
  if (doc.threadId && typeof doc.threadId === 'string' && doc.threadId.trim()) {
    return doc.threadId.trim();
  }
  if (doc.gmailThreadId && typeof doc.gmailThreadId === 'string' && doc.gmailThreadId.trim()) {
    return doc.gmailThreadId.trim();
  }
  if (doc.metadata?.gmailThreadId && typeof doc.metadata.gmailThreadId === 'string' && doc.metadata.gmailThreadId.trim()) {
    return doc.metadata.gmailThreadId.trim();
  }
  if (doc.metadata?.threadId && typeof doc.metadata.threadId === 'string' && doc.metadata.threadId.trim()) {
    return doc.metadata.threadId.trim();
  }
  if (doc.rfcMessageId && typeof doc.rfcMessageId === 'string' && doc.rfcMessageId.trim()) {
    return `msg:${doc.rfcMessageId.trim()}`;
  }
  if (doc.metadata?.rfcMessageId && typeof doc.metadata.rfcMessageId === 'string' && doc.metadata.rfcMessageId.trim()) {
    return `msg:${doc.metadata.rfcMessageId.trim()}`;
  }
  if (doc.leadId !== undefined && doc.leadId !== null && String(doc.leadId).trim() !== '') {
    const rawSubject = (doc.subject || '').replace(/^(re|fwd|aw|wg):\s*/i, '').trim().toLowerCase();
    if (rawSubject) {
      return `lead:${String(doc.leadId).trim()}:${rawSubject}`;
    }
    return `lead:${String(doc.leadId).trim()}`;
  }
  return `msg:${doc._id ? doc._id.toString() : String(Math.random())}`;
}

function parseSingleEmail(raw: any): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const match = raw.match(/<([^>]+)>/) || raw.match(/([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/);
  if (match) {
    const email = (match[1] || match[0]).trim().toLowerCase();
    if (email.includes('@')) return email;
  }
  return undefined;
}

function parseAddressStrings(raw: any): string[] | undefined {
  if (!raw) return undefined;
  const emails: string[] = [];
  const regex = /(?:<([^\s<>@]+@[^\s<>@]+)>|([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+))/g;

  const extract = (str: string) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(str)) !== null) {
      const addr = (match[1] || match[2] || '').trim().toLowerCase();
      if (addr && addr.includes('@') && !emails.includes(addr)) {
        emails.push(addr);
      }
    }
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') extract(item);
    }
  } else if (typeof raw === 'string') {
    extract(raw);
  }

  return emails.length > 0 ? emails : undefined;
}

/**
 * Normalizes an activityLog record into an InboxMessage.
 */
function mapActivityToInboxMessage(doc: any): InboxMessage {
  const threadId = resolveMessageThreadId(doc);
  const rawBody = doc.bodyExcerpt || doc.text || doc.notes || doc.body || '';
  const bodyText = cleanHtmlBody(rawBody);

  const toList = parseAddressStrings(doc.toAddresses) || parseAddressStrings(doc.to);
  const ccList = parseAddressStrings(doc.ccAddresses) || parseAddressStrings(doc.cc);

  return {
    id: doc._id ? doc._id.toString() : String(Math.random()),
    threadId,
    leadId: doc.leadId ? String(doc.leadId) : '',
    type: doc.type || 'system',
    direction: doc.direction ?? null,
    subject: doc.subject || undefined,
    body: bodyText,
    from: parseSingleEmail(doc.fromAddress || doc.from) || doc.fromAddress || doc.from,
    to: toList,
    cc: ccList,
    createdAt: (doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt || Date.now())).toISOString(),
    source: doc.source || 'activity-log',
    callDisposition: doc.callDisposition,
    callDurationMinutes: doc.callDurationMinutes,
    loggedBy: doc.loggedBy,
    rfcMessageId: doc.rfcMessageId,
    inReplyTo: doc.inReplyTo,
    references: doc.references,
    emailStatus: doc.emailStatus,
    openCount: doc.openCount,
    clickCount: doc.clickCount,
    userId: doc.userId,
    userEmail: doc.userEmail,
    connectionId: doc.connectionId,
  };
}

/**
 * Normalizes an outreach_logs record into an InboxMessage.
 */
function mapOutreachToInboxMessage(log: any): InboxMessage {
  const threadId = resolveMessageThreadId(log);
  const rawBody = log.body || '';
  const bodyText = cleanHtmlBody(rawBody);

  const toList = parseAddressStrings(log.to);
  const ccList = parseAddressStrings(log.cc);

  return {
    id: log._id ? log._id.toString() : String(Math.random()),
    threadId,
    leadId: log.leadId ? String(log.leadId) : '',
    type: 'email-outbound',
    direction: 'outbound',
    subject: log.subject || undefined,
    body: bodyText,
    from: parseSingleEmail(log.from) || log.from,
    to: toList,
    cc: ccList,
    createdAt: (log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt || Date.now())).toISOString(),
    source: log.source || 'outreach-log',
    rfcMessageId: log.rfcMessageId,
    inReplyTo: log.inReplyTo,
    references: log.references,
    openCount: log.openCount,
    clickCount: log.clickCount,
    userId: log.userId,
    userEmail: log.userEmail || (log.source === 'gmail' ? log.from : undefined),
    connectionId: log.connectionId,
  };
}

/**
 * Lists conversation threads aggregated from activityLog and outreach_logs,
 * merged with thread read/starred/archived states, mailbox scoping, and lead details.
 */
export async function listInboxThreads(
  db: Db,
  brand: string,
  tenantId: string,
  options: InboxListOptions = {}
): Promise<{
  threads: InboxThread[];
  counts: InboxCounts;
  total: number;
  mailboxes: InboxMailboxOption[];
  activeScope: 'my';
}> {
  await ensureInboxIndexes(db);
  await ensureActivityLogIndexes(db);

  const brandFilter: Record<string, any> = { brand };
  if (tenantId) brandFilter.tenantId = tenantId;

  // 1. Fetch recent activityLog and outreach_logs entries
  const [activityDocs, outreachDocs] = await Promise.all([
    db.collection(ACTIVITY_LOG_COLLECTION)
      .find(brandFilter)
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray()
      .catch(() => []),
    db.collection('outreach_logs')
      .find({
        ...brandFilter,
        activityLogWritten: { $ne: true },
      })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray()
      .catch(() => []),
  ]);

  // 2. Map and group messages into threads
  const messagesByThread = new Map<string, InboxMessage[]>();

  for (const doc of activityDocs) {
    // Filter out purely internal team communications (e.g. staff weekly meetings, internal syncs)
    if (doc.type === 'email-inbound' || doc.type === 'email-outbound') {
      const fromAddr = doc.fromAddress || doc.from;
      const toAddrs = parseAddressStrings(doc.toAddresses) || parseAddressStrings(doc.to) || [];
      const ccAddrs = parseAddressStrings(doc.ccAddresses) || parseAddressStrings(doc.cc) || [];
      const participants = [fromAddr, ...toAddrs, ...ccAddrs].filter(Boolean);
      if (
        fromAddr &&
        toAddrs.length > 0 &&
        participants.length >= 2 &&
        participants.every((p) => isInternalOrSystemEmail(p, { brand }))
      ) {
        continue;
      }
    }
    const msg = mapActivityToInboxMessage(doc);
    const existing = messagesByThread.get(msg.threadId) || [];
    existing.push(msg);
    messagesByThread.set(msg.threadId, existing);
  }

  for (const log of outreachDocs) {
    const msg = mapOutreachToInboxMessage(log);
    const existing = messagesByThread.get(msg.threadId) || [];
    existing.push(msg);
    messagesByThread.set(msg.threadId, existing);
  }

  // If no communications exist, return empty
  if (messagesByThread.size === 0) {
    return {
      threads: [],
      counts: { all: 0, inbox: 0, sent: 0, needs_reply: 0, internal: 0, calls: 0, system: 0, unread: 0 },
      total: 0,
      mailboxes: [],
      activeScope: 'my',
    };
  }

  // Load user's connected mailboxes and user IDs to power My Inbox scoping
  const userMailboxSet = new Set<string>();
  const candidateEmails = new Set<string>();
  const userIds = new Set<string>();

  if (options.userId) {
    userIds.add(options.userId);
  }

  if (options.userEmail) {
    const primaryEmail = options.userEmail.toLowerCase().trim();
    candidateEmails.add(primaryEmail);
    userMailboxSet.add(primaryEmail);

    const aliases = KNOWN_USER_ALIASES[primaryEmail] || [];
    for (const alias of aliases) {
      candidateEmails.add(alias.toLowerCase().trim());
      userMailboxSet.add(alias.toLowerCase().trim());
    }
  }

  // Issue 271: Fail-Closed Privacy Guard — if no user identity or email is resolved,
  // strictly return empty results rather than leaking team correspondence across reps.
  if (userIds.size === 0 && candidateEmails.size === 0) {
    return {
      threads: [],
      counts: { all: 0, inbox: 0, sent: 0, needs_reply: 0, internal: 0, calls: 0, system: 0, unread: 0 },
      total: 0,
      mailboxes: [],
      activeScope: 'my',
    };
  }

  // Find linked SSO user accounts and admin-managed aliases matching candidate emails or user IDs
  const ssoMatches = await db.collection('sso_user_access')
    .find(
      {
        $or: [
          ...(userIds.size > 0 ? [{ ssoUserId: { $in: Array.from(userIds) } }] : []),
          ...(candidateEmails.size > 0 ? [{ email: { $in: Array.from(candidateEmails) } }] : []),
          ...(candidateEmails.size > 0 ? [{ aliases: { $in: Array.from(candidateEmails) } }] : []),
        ],
      },
      { projection: { ssoUserId: 1, email: 1, aliases: 1 } }
    )
    .toArray()
    .catch(() => []);

  for (const s of ssoMatches) {
    if (s.ssoUserId) userIds.add(s.ssoUserId);
    if (s.email) {
      const normEmail = s.email.toLowerCase().trim();
      userMailboxSet.add(normEmail);
      candidateEmails.add(normEmail);
    }
    if (Array.isArray(s.aliases)) {
      for (const a of s.aliases) {
        if (typeof a === 'string' && a.includes('@')) {
          const normAlias = a.toLowerCase().trim();
          userMailboxSet.add(normAlias);
          candidateEmails.add(normAlias);
        }
      }
    }
  }

  // Find all active Gmail connections for these userIds or emails
  if (userIds.size > 0 || candidateEmails.size > 0) {
    const userConns = await db.collection('integration_connections')
      .find(
        {
          provider: 'gmail',
          status: 'active',
          $or: [
            ...(userIds.size > 0 ? [{ userId: { $in: Array.from(userIds) } }] : []),
            ...(userIds.size > 0 ? [{ connectedBy: { $in: Array.from(userIds) } }] : []),
            ...(candidateEmails.size > 0 ? [{ userEmail: { $in: Array.from(candidateEmails) } }] : []),
          ],
        },
        { projection: { userEmail: 1, userId: 1 } }
      )
      .toArray()
      .catch(() => []);
    for (const c of userConns) {
      if (c.userEmail) userMailboxSet.add(c.userEmail.toLowerCase().trim());
      if (c.userId) userIds.add(c.userId);
    }
  }

  // Issue 271: Retrieve company/brand inbox policy settings
  const companySettingsDoc = await (typeof db.collection('company_settings')?.findOne === 'function'
    ? db.collection('company_settings').findOne({ brand, ...(tenantId ? { tenantId } : {}) })
    : Promise.resolve(null)
  ).catch(() => null);
  const includeAssignedLeadThreads = Boolean(
    (companySettingsDoc as any)?.inboxSettings?.includeAssignedLeadThreads
  );
  const includeCcThreads = Boolean(
    (companySettingsDoc as any)?.inboxSettings?.includeCcThreads
  );

  // 3. Load thread states
  const threadIds = Array.from(messagesByThread.keys());
  const threadStates = await db.collection(INBOX_THREAD_STATES_COLLECTION)
    .find({
      brand,
      threadId: { $in: threadIds },
      ...(tenantId ? { tenantId } : {}),
    })
    .toArray()
    .catch(() => []);

  const stateByThread = new Map<string, any>();
  for (const st of threadStates) {
    stateByThread.set(st.threadId, st);
  }

  // 4. Resolve lead IDs and fetch lead details
  const leadIdSet = new Set<string>();
  for (const msgs of messagesByThread.values()) {
    for (const m of msgs) {
      if (m.leadId) leadIdSet.add(m.leadId);
    }
  }

  const brandConfig = await getBrandConfig(brand).catch(() => null);
  const leadsCollectionName = brandConfig?.dbCollection || 'leads';

  const leadLookup = new Map<string, any>();
  if (leadIdSet.size > 0) {
    const rawLeadIds = Array.from(leadIdSet);
    const objectIds: ObjectId[] = [];
    const literalIds: any[] = [];

    for (const lid of rawLeadIds) {
      literalIds.push(lid);
      const num = Number(lid);
      if (!Number.isNaN(num)) literalIds.push(num);
      if (ObjectId.isValid(lid)) {
        try {
          objectIds.push(new ObjectId(lid));
        } catch {
          // ignore invalid objectid
        }
      }
    }

    const orClauses: any[] = [{ id: { $in: literalIds } }];
    if (objectIds.length > 0) {
      orClauses.push({ _id: { $in: objectIds } });
    }

    const leadDocs = await db.collection(leadsCollectionName)
      .find({
        $or: orClauses,
        ...(tenantId ? { tenantId } : {}),
      }, {
        projection: {
          _id: 1,
          id: 1,
          entity_name: 1,
          name: 1,
          kanbanColumn: 1,
          status: 1,
          contacts: 1,
          deals: 1,
          estimated_annual_revenue_usd: 1,
          ticketSizeEstimate: 1,
          assignedTo: 1,
          assignedToEmail: 1,
        },
      })
      .toArray()
      .catch(() => []);

    for (const l of leadDocs) {
      if (l._id) leadLookup.set(l._id.toString(), l);
      if (l.id !== undefined && l.id !== null) leadLookup.set(String(l.id), l);
    }
  }

  // 5. Construct InboxThread objects
  const allThreads: InboxThread[] = [];
  const mailboxCounts = new Map<string, number>();

  for (const [threadId, msgs] of messagesByThread.entries()) {
    // Sort messages chronologically oldest to newest
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const lastMessage = msgs[msgs.length - 1];
    const threadLeadId = msgs.find((m) => m.leadId)?.leadId || '';
    const lead = threadLeadId ? leadLookup.get(threadLeadId) : null;

    const lastInbound = msgs.slice().reverse().find((m) => m.direction === 'inbound' && m.from);
    const lastOutbound = msgs.slice().reverse().find((m) => m.direction === 'outbound' && m.to && m.to[0]);

    // Parse counterparty display name and email:
    // Strictly resolve the external prospect/client counterparty, NEVER internal company colleagues!
    const findExternalParticipant = (): string => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.from && !isInternalOrSystemEmail(m.from, { brand })) {
          return m.from;
        }
      }
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.to) {
          const extTo = m.to.find((t) => !isInternalOrSystemEmail(t, { brand }));
          if (extTo) return extTo;
        }
        if (m.cc) {
          const extCc = m.cc.find((c) => !isInternalOrSystemEmail(c, { brand }));
          if (extCc) return extCc;
        }
      }
      return '';
    };

    const externalAddress = findExternalParticipant();
    let counterpartyRaw = externalAddress;
    if (!counterpartyRaw) {
      if (lastInbound?.from && !isInternalOrSystemEmail(lastInbound.from, { brand })) {
        counterpartyRaw = lastInbound.from;
      } else if (lastOutbound?.to && lastOutbound.to[0] && !isInternalOrSystemEmail(lastOutbound.to[0], { brand })) {
        counterpartyRaw = lastOutbound.to[0];
      } else {
        counterpartyRaw = lastMessage.from || '';
      }
    }

    const parsedSender = parseEmailParticipant(counterpartyRaw);
    const senderDisplayName = parsedSender?.name || (counterpartyRaw.includes('@') ? formatLocalPartAsName(counterpartyRaw.split('@')[0]) : counterpartyRaw) || undefined;
    const senderEmail = parsedSender?.email || (counterpartyRaw.includes('@') ? counterpartyRaw.trim().toLowerCase() : undefined);

    const validContact = lead?.contacts?.find((c: any) => c.email && !isInternalOrSystemEmail(c.email, { brand })) || lead?.contacts?.[0];
    const contactName = validContact?.name || senderDisplayName || undefined;
    const contactEmail = (validContact?.email && !isInternalOrSystemEmail(validContact.email, { brand }) ? validContact.email : undefined) ||
                         (senderEmail && !isInternalOrSystemEmail(senderEmail, { brand }) ? senderEmail : undefined) ||
                         (externalAddress || undefined);
    const dealValue = lead?.deals?.[0]?.amount || lead?.estimated_annual_revenue_usd || lead?.ticketSizeEstimate?.estimatedValue || undefined;

    // Never show 'System Communications' for an email conversation:
    let leadName = lead?.entity_name || lead?.name;
    if (!leadName) {
      if (threadLeadId) {
        leadName = `Lead #${threadLeadId.slice(-6)}`;
      } else if (senderDisplayName) {
        leadName = senderDisplayName;
      } else if (senderEmail) {
        leadName = senderEmail;
      } else if (lastMessage.subject && lastMessage.subject !== 'No Subject') {
        leadName = lastMessage.subject;
      } else if (msgs.some((m) => m.type.startsWith('email'))) {
        leadName = 'External Prospect';
      } else {
        leadName = 'System Activity';
      }
    }

    const hasLead = Boolean(threadLeadId && lead);
    const contactsCount = (lead?.contacts && Array.isArray(lead.contacts)) ? lead.contacts.length : (contactEmail ? 1 : 0);
    const hasContact = contactsCount > 0;
    const dealsCount = (lead?.deals && Array.isArray(lead.deals)) ? lead.deals.length : (dealValue ? 1 : 0);
    const hasDeal = dealsCount > 0;

    const leadStage = lead?.kanbanColumn || lead?.status || undefined;
    const subject = lastMessage.subject || msgs.slice().reverse().find((m) => m.subject)?.subject || 'No Subject';
    const snippet = cleanMessageSnippet(lastMessage.body, 140) || '';

    // Streams classification
    const streams = new Set<InboxStream>(['all']);
    let hasInbound = false;
    let hasOutbound = false;
    let hasNote = false;
    let hasCall = false;
    let hasSystem = false;

    for (const m of msgs) {
      if (m.type === 'email-inbound') hasInbound = true;
      if (m.type === 'email-outbound') hasOutbound = true;
      if (m.type === 'note') hasNote = true;
      if (m.type === 'call') hasCall = true;
      if (m.type === 'system' || m.type === 'meeting-scheduled') hasSystem = true;
    }

    if (hasInbound) streams.add('inbox');
    if (hasOutbound) streams.add('sent');
    if (hasNote) streams.add('internal');
    if (hasCall) streams.add('calls');
    if (hasSystem) streams.add('system');

    // Needs reply: external prospect sent the latest message (strictly non-internal) and it's inbound email
    const lastMsgFromInternal = lastMessage.from ? isInternalOrSystemEmail(lastMessage.from, { brand }) : false;
    const needsReply = !lastMsgFromInternal && lastMessage.direction === 'inbound' && lastMessage.type === 'email-inbound';
    if (needsReply) {
      streams.add('needs_reply');
    }

    const state = stateByThread.get(threadId);
    const defaultUnread = lastMessage.direction === 'inbound';
    const isRead = state?.isRead !== undefined ? Boolean(state.isRead) : !defaultUnread;
    const isStarred = Boolean(state?.isStarred);
    const isArchived = Boolean(state?.isArchived);

    // Issue 268 & 271: Mailbox ownership and My Inbox attribution
    let isMyInbox = false;
    let userMailbox: string | undefined = undefined;

    for (const m of msgs) {
      if (m.type === 'email-inbound' || m.type === 'email-outbound') {
        const fromEmail = m.from?.toLowerCase().trim();
        const toList = (m.to || []).map((t) => t.toLowerCase().trim());
        const ccList = (m.cc || []).map((c) => c.toLowerCase().trim());

        const isSender = Boolean(fromEmail && userMailboxSet.has(fromEmail));
        const isDirectRecipient = toList.some((t) => userMailboxSet.has(t));
        const isOnCc = ccList.some((c) => userMailboxSet.has(c));

        if (isSender) {
          isMyInbox = true;
          if (!userMailbox) userMailbox = fromEmail;
        } else if (isDirectRecipient) {
          isMyInbox = true;
          if (!userMailbox) {
            const match = toList.find((t) => userMailboxSet.has(t));
            if (match) userMailbox = match;
          }
        } else if (isOnCc && includeCcThreads) {
          isMyInbox = true;
          if (!userMailbox) {
            const match = ccList.find((c) => userMailboxSet.has(c));
            if (match) userMailbox = match;
          }
        } else if (!isOnCc && m.direction === 'inbound') {
          // Fallback for inbound messages where explicit `to` was omitted (e.g. legacy/mock records)
          const msgUserEmail = m.userEmail?.toLowerCase().trim();
          if (msgUserEmail && userMailboxSet.has(msgUserEmail)) {
            isMyInbox = true;
            if (!userMailbox) userMailbox = msgUserEmail;
          }
        }
      } else {
        // Internal notes, calls, system events created by or assigned to this user
        const msgUserEmail = m.userEmail?.toLowerCase().trim();
        if (msgUserEmail && userMailboxSet.has(msgUserEmail)) {
          isMyInbox = true;
          if (!userMailbox) userMailbox = msgUserEmail;
        }
        if (m.userId && userIds.has(m.userId)) {
          isMyInbox = true;
        }
      }
    }

    // Issue 271: Only inherit leads into personal inbox if the brand's policy permits it
    if (!isMyInbox && includeAssignedLeadThreads && lead) {
      if (
        (lead.assignedToEmail && userMailboxSet.has(lead.assignedToEmail.toLowerCase().trim())) ||
        (lead.assignedTo && userIds.has(lead.assignedTo))
      ) {
        isMyInbox = true;
      }
    }

    if (!userMailbox && options.userEmail) {
      userMailbox = options.userEmail.toLowerCase().trim();
    }

    if (userMailbox) {
      mailboxCounts.set(userMailbox, (mailboxCounts.get(userMailbox) || 0) + 1);
    }

    allThreads.push({
      id: threadId,
      leadId: threadLeadId,
      leadName,
      leadStage,
      contactName,
      contactEmail,
      senderDisplayName,
      senderEmail,
      hasLead,
      hasContact,
      hasDeal,
      dealsCount,
      contactsCount,
      dealValue,
      subject,
      snippet,
      lastMessageAt: lastMessage.createdAt,
      lastMessageType: lastMessage.type,
      lastMessageDirection: lastMessage.direction,
      messageCount: msgs.length,
      isRead,
      isStarred,
      isArchived,
      needsReply,
      streams: Array.from(streams),
      isMyInbox,
      userMailbox,
    });
  }

  // Team Inbox is disabled per user directive; always enforce 'my' scope
  const requestedScope: 'my' = 'my';

  // 6. Filter by scope: strictly My Inbox (threads belonging to user's connected mailboxes or assigned leads)
  let scopedThreads = allThreads.filter((t) => t.isMyInbox);

  // Filter by specific mailbox if requested
  if (options.mailbox && options.mailbox !== 'all') {
    const selectedMailbox = options.mailbox.toLowerCase().trim();
    scopedThreads = scopedThreads.filter(
      (t) => t.userMailbox === selectedMailbox || t.contactEmail === selectedMailbox
    );
  }

  // 7. Compute counts across unarchived scoped threads
  const counts: InboxCounts = {
    all: 0,
    inbox: 0,
    sent: 0,
    needs_reply: 0,
    internal: 0,
    calls: 0,
    system: 0,
    unread: 0,
  };

  for (const t of scopedThreads) {
    if (!t.isArchived) {
      counts.all++;
      if (t.streams.includes('inbox')) counts.inbox++;
      if (t.streams.includes('sent')) counts.sent++;
      if (t.streams.includes('needs_reply')) counts.needs_reply++;
      if (t.streams.includes('internal')) counts.internal++;
      if (t.streams.includes('calls')) counts.calls++;
      if (t.streams.includes('system')) counts.system++;
      if (!t.isRead) counts.unread++;
    }
  }

  // 8. Filter threads according to requested options
  let filtered = scopedThreads;

  if (options.archivedOnly) {
    filtered = filtered.filter((t) => t.isArchived);
  } else {
    filtered = filtered.filter((t) => !t.isArchived);
  }

  if (options.starredOnly) {
    filtered = filtered.filter((t) => t.isStarred);
  }

  if (options.unreadOnly) {
    filtered = filtered.filter((t) => !t.isRead);
  }

  if (options.stream && options.stream !== 'all') {
    filtered = filtered.filter((t) => t.streams.includes(options.stream as InboxStream));
  }

  if (options.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase();
    filtered = filtered.filter((t) => {
      return (
        t.subject.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        t.leadName.toLowerCase().includes(q) ||
        (t.contactName && t.contactName.toLowerCase().includes(q)) ||
        (t.contactEmail && t.contactEmail.toLowerCase().includes(q)) ||
        (t.leadId && t.leadId.toLowerCase().includes(q))
      );
    });
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const total = filtered.length;
  const offset = Math.max(0, options.offset || 0);
  const limit = Math.max(1, Math.min(200, options.limit || 50));
  const paged = filtered.slice(offset, offset + limit);

  const mailboxes: InboxMailboxOption[] = Array.from(mailboxCounts.entries())
    .filter(([email]) => userMailboxSet.size === 0 || userMailboxSet.has(email))
    .map(([email, count]) => ({
      email,
      label: email,
      count,
    }));

  return {
    threads: paged,
    counts,
    total,
    mailboxes,
    activeScope: requestedScope,
  };
}

/**
 * Retrieves full conversation thread detail and chronological message list.
 */
export async function getInboxThreadDetail(
  db: Db,
  brand: string,
  tenantId: string,
  threadId: string,
  options: { userId?: string; userEmail?: string; markRead?: boolean } = {}
): Promise<{ thread: InboxThread | null; messages: InboxMessage[]; lead: any | null; participants: NormalizedContact[] }> {
  await ensureInboxIndexes(db);
  await ensureActivityLogIndexes(db);

  const brandFilter: Record<string, any> = { brand };
  if (tenantId) brandFilter.tenantId = tenantId;

  // Build filter for messages in this thread
  const isLeadThread = threadId.startsWith('lead:');
  const leadParts = isLeadThread ? threadId.replace(/^lead:/, '').split(':') : [];
  const targetLeadId = leadParts[0] || undefined;
  const targetSubject = leadParts[1] || undefined;

  const activityFilter: Record<string, any> = { ...brandFilter };
  const outreachFilter: Record<string, any> = { ...brandFilter, activityLogWritten: { $ne: true } };

  if (isLeadThread && targetLeadId) {
    if (targetSubject) {
      const subjectRegex = new RegExp(targetSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      activityFilter.$or = [{ threadId }, { leadId: targetLeadId, subject: subjectRegex }];
      outreachFilter.$or = [{ gmailThreadId: threadId }, { leadId: targetLeadId, subject: subjectRegex }];
    } else {
      activityFilter.$or = [{ threadId }, { leadId: targetLeadId }];
      outreachFilter.$or = [{ gmailThreadId: threadId }, { leadId: targetLeadId }];
    }
  } else {
    activityFilter.$or = [{ threadId }, { externalId: threadId }];
    outreachFilter.$or = [{ gmailThreadId: threadId }, { resendEmailId: threadId }, { gmailMessageId: threadId }];
  }

  const [activityDocs, outreachDocs, stateDoc] = await Promise.all([
    db.collection(ACTIVITY_LOG_COLLECTION).find(activityFilter).sort({ createdAt: 1 }).toArray().catch(() => []),
    db.collection('outreach_logs').find(outreachFilter).sort({ createdAt: 1 }).toArray().catch(() => []),
    db.collection(INBOX_THREAD_STATES_COLLECTION).findOne({
      brand,
      threadId,
      ...(tenantId ? { tenantId } : {}),
    }).catch(() => null),
  ]);

  const messages: InboxMessage[] = [
    ...activityDocs.map(mapActivityToInboxMessage),
    ...outreachDocs.map(mapOutreachToInboxMessage),
  ];

  messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (messages.length === 0) {
    return { thread: null, messages: [], lead: null, participants: [] };
  }

  const lastMessage = messages[messages.length - 1];
  const leadId = messages.find((m) => m.leadId)?.leadId || targetLeadId || '';

  // Load Lead details
  let lead: any = null;
  if (leadId) {
    const brandConfig = await getBrandConfig(brand).catch(() => null);
    const leadsCollectionName = brandConfig?.dbCollection || 'leads';
    const orClauses: any[] = [{ id: leadId }];
    const num = Number(leadId);
    if (!Number.isNaN(num)) orClauses.push({ id: num });
    if (ObjectId.isValid(leadId)) {
      try {
        orClauses.push({ _id: new ObjectId(leadId) });
      } catch {
        // ignore
      }
    }
    lead = await db.collection(leadsCollectionName).findOne({
      $or: orClauses,
      ...(tenantId ? { tenantId } : {}),
    }).catch(() => null);
  }

  // Issue 271: Strict user mailbox privacy check in My Inbox scope
  if (options.userEmail || options.userId) {
    const candidateEmails = new Set<string>();
    const userIds = new Set<string>();
    if (options.userId) userIds.add(options.userId);
    if (options.userEmail) {
      const primaryEmail = options.userEmail.toLowerCase().trim();
      candidateEmails.add(primaryEmail);
      const aliases = KNOWN_USER_ALIASES[primaryEmail] || [];
      for (const a of aliases) candidateEmails.add(a.toLowerCase().trim());
    }

    const ssoMatches = await db.collection('sso_user_access')
      .find({
        $or: [
          ...(userIds.size > 0 ? [{ ssoUserId: { $in: Array.from(userIds) } }] : []),
          ...(candidateEmails.size > 0 ? [{ email: { $in: Array.from(candidateEmails) } }] : []),
          ...(candidateEmails.size > 0 ? [{ aliases: { $in: Array.from(candidateEmails) } }] : []),
        ],
      }, { projection: { ssoUserId: 1, email: 1, aliases: 1 } })
      .toArray()
      .catch(() => []);

    for (const s of ssoMatches) {
      if (s.ssoUserId) userIds.add(s.ssoUserId);
      if (s.email) candidateEmails.add(s.email.toLowerCase().trim());
      if (Array.isArray(s.aliases)) {
        for (const a of s.aliases) {
          if (typeof a === 'string' && a.includes('@')) candidateEmails.add(a.toLowerCase().trim());
        }
      }
    }

    const companySettingsDoc = await (typeof db.collection('company_settings')?.findOne === 'function'
      ? db.collection('company_settings').findOne({ brand, ...(tenantId ? { tenantId } : {}) })
      : Promise.resolve(null)
    ).catch(() => null);
    const includeAssigned = Boolean((companySettingsDoc as any)?.inboxSettings?.includeAssignedLeadThreads);
    const includeCc = Boolean((companySettingsDoc as any)?.inboxSettings?.includeCcThreads);

    const hasEmailMessages = messages.some(
      (m) => (m.type === 'email-inbound' || m.type === 'email-outbound') && Boolean(m.from || (m.to && m.to.length > 0))
    );
    if (hasEmailMessages) {
      let hasAccess = false;
      for (const m of messages) {
        if (m.type === 'email-inbound' || m.type === 'email-outbound') {
          const fromEmail = m.from?.toLowerCase().trim();
          const toList = (m.to || []).map((t) => t.toLowerCase().trim());
          const ccList = (m.cc || []).map((c) => c.toLowerCase().trim());

          if (fromEmail && candidateEmails.has(fromEmail)) { hasAccess = true; break; }
          if (toList.some((t) => candidateEmails.has(t))) { hasAccess = true; break; }
          if (includeCc && ccList.some((c) => candidateEmails.has(c))) { hasAccess = true; break; }
          if (!ccList.some((c) => candidateEmails.has(c)) && m.direction === 'inbound') {
            const msgUserEmail = m.userEmail?.toLowerCase().trim();
            if (msgUserEmail && candidateEmails.has(msgUserEmail)) { hasAccess = true; break; }
          }
        }
      }

      if (!hasAccess && includeAssigned && lead) {
        if (
          (lead.assignedToEmail && candidateEmails.has(lead.assignedToEmail.toLowerCase().trim())) ||
          (lead.assignedTo && userIds.has(lead.assignedTo))
        ) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        return { thread: null, messages: [], lead: null, participants: [] };
      }
    }
  }

  const lastInbound = messages.slice().reverse().find((m) => m.direction === 'inbound' && m.from);
  const lastOutbound = messages.slice().reverse().find((m) => m.direction === 'outbound' && m.to && m.to[0]);

  // Parse counterparty display name and email:
  // Strictly resolve the external prospect/client counterparty, NEVER internal company colleagues!
  const findExternalParticipant = (): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.from && !isInternalOrSystemEmail(m.from, { brand })) {
        return m.from;
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.to) {
        const extTo = m.to.find((t) => !isInternalOrSystemEmail(t, { brand }));
        if (extTo) return extTo;
      }
      if (m.cc) {
        const extCc = m.cc.find((c) => !isInternalOrSystemEmail(c, { brand }));
        if (extCc) return extCc;
      }
    }
    return '';
  };

  const externalAddress = findExternalParticipant();
  let counterpartyRaw = externalAddress;
  if (!counterpartyRaw) {
    if (lastInbound?.from && !isInternalOrSystemEmail(lastInbound.from, { brand })) {
      counterpartyRaw = lastInbound.from;
    } else if (lastOutbound?.to && lastOutbound.to[0] && !isInternalOrSystemEmail(lastOutbound.to[0], { brand })) {
      counterpartyRaw = lastOutbound.to[0];
    } else {
      counterpartyRaw = lastMessage.from || '';
    }
  }

  const parsedSender = parseEmailParticipant(counterpartyRaw);
  const senderDisplayName = parsedSender?.name || (counterpartyRaw.includes('@') ? formatLocalPartAsName(counterpartyRaw.split('@')[0]) : counterpartyRaw) || undefined;
  const senderEmail = parsedSender?.email || (counterpartyRaw.includes('@') ? counterpartyRaw.trim().toLowerCase() : undefined);

  const validContact = lead?.contacts?.find((c: any) => c.email && !isInternalOrSystemEmail(c.email, { brand })) || lead?.contacts?.[0];
  const contactName = validContact?.name || senderDisplayName || undefined;
  const contactEmail = (validContact?.email && !isInternalOrSystemEmail(validContact.email, { brand }) ? validContact.email : undefined) ||
                       (senderEmail && !isInternalOrSystemEmail(senderEmail, { brand }) ? senderEmail : undefined) ||
                       (externalAddress || undefined);
  const dealValue = lead?.deals?.[0]?.amount || lead?.estimated_annual_revenue_usd || lead?.ticketSizeEstimate?.estimatedValue || undefined;

  let leadName = lead?.entity_name || lead?.name;
  if (!leadName) {
    if (leadId) {
      leadName = `Lead #${leadId.slice(-6)}`;
    } else if (senderDisplayName) {
      leadName = senderDisplayName;
    } else if (senderEmail) {
      leadName = senderEmail;
    } else if (lastMessage.subject && lastMessage.subject !== 'No Subject') {
      leadName = lastMessage.subject;
    } else if (messages.some((m) => m.type.startsWith('email'))) {
      leadName = 'External Prospect';
    } else {
      leadName = 'System Activity';
    }
  }

  const hasLead = Boolean(leadId && lead);
  const contactsCount = (lead?.contacts && Array.isArray(lead.contacts)) ? lead.contacts.length : (contactEmail ? 1 : 0);
  const hasContact = contactsCount > 0;
  const dealsCount = (lead?.deals && Array.isArray(lead.deals)) ? lead.deals.length : (dealValue ? 1 : 0);
  const hasDeal = dealsCount > 0;

  const leadStage = lead?.kanbanColumn || lead?.status || undefined;
  const subject = lastMessage.subject || messages.slice().reverse().find((m) => m.subject)?.subject || 'No Subject';
  const snippet = cleanMessageSnippet(lastMessage.body, 140) || '';

  const streams = new Set<InboxStream>(['all']);
  for (const m of messages) {
    if (m.type === 'email-inbound') streams.add('inbox');
    if (m.type === 'email-outbound') streams.add('sent');
    if (m.type === 'note') streams.add('internal');
    if (m.type === 'call') streams.add('calls');
    if (m.type === 'system' || m.type === 'meeting-scheduled') streams.add('system');
  }

  const lastMsgFromInternal = lastMessage.from ? isInternalOrSystemEmail(lastMessage.from, { brand }) : false;
  const needsReply = !lastMsgFromInternal && lastMessage.direction === 'inbound' && lastMessage.type === 'email-inbound';
  if (needsReply) streams.add('needs_reply');

  const defaultUnread = lastMessage.direction === 'inbound';
  let isRead = stateDoc?.isRead !== undefined ? Boolean(stateDoc.isRead) : !defaultUnread;
  const isStarred = Boolean(stateDoc?.isStarred);
  const isArchived = Boolean(stateDoc?.isArchived);

  // If markRead requested, update thread state
  if (options.markRead && !isRead) {
    await setThreadStatus(db, brand, tenantId, threadId, { isRead: true }, options.userId);
    isRead = true;
  }

  // Harvest all unique external participants across all messages in this thread
  const participantsMap = new Map<string, NormalizedContact>();
  for (const m of messages) {
    const extracted = extractContactsFromEmailMessage(
      { from: m.from, to: m.to, cc: m.cc, body: m.body },
      { brand }
    );
    for (const p of extracted) {
      if (!participantsMap.has(p.email)) {
        participantsMap.set(p.email, p);
      }
    }
  }
  const participants = Array.from(participantsMap.values());

  // Automatically merge newly discovered email contacts into the associated Lead ONLY if they belong to the same company domain
  if (lead && leadId && participants.length > 0) {
    try {
      const leadUrl = (lead.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const existingContactDomains = new Set<string>();
      if (leadUrl && !COMMON_PUBLIC_MAIL_DOMAINS.has(leadUrl)) existingContactDomains.add(leadUrl);
      if (Array.isArray(lead.contacts)) {
        for (const c of lead.contacts) {
          if (c?.email && c.email.includes('@')) {
            const dom = c.email.split('@')[1].toLowerCase().trim();
            if (!COMMON_PUBLIC_MAIL_DOMAINS.has(dom)) existingContactDomains.add(dom);
          }
        }
      }

      // Filter participants: only merge those who belong to the same company domain OR already exist on the lead
      const sameCompanyParticipants = participants.filter((p) => {
        const pDom = p.email.includes('@') ? p.email.split('@')[1].toLowerCase().trim() : '';
        const alreadyOnLead = Array.isArray(lead.contacts) && lead.contacts.some((c: any) => c?.email?.toLowerCase() === p.email.toLowerCase());
        if (alreadyOnLead) return true;
        if (pDom && existingContactDomains.has(pDom)) return true;
        return false;
      });

      if (sameCompanyParticipants.length > 0) {
        const mergeRes = await mergeContactsIntoLead(db, brand, tenantId, leadId, sameCompanyParticipants);
        if (mergeRes && mergeRes.contacts) {
          lead.contacts = mergeRes.contacts;
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Identify existing CRM contacts across the active brand/tenant so participants already in CRM
  // can be opened directly, rather than showing "+ Contact"
  if (participants.length > 0) {
    try {
      // 1. Check if participant is already on this thread's associated lead
      if (lead && Array.isArray(lead.contacts)) {
        for (const p of participants) {
          const pEmail = p.email.toLowerCase().trim();
          const matched = lead.contacts.find((c: any) =>
            (c?.email && c.email.toLowerCase().trim() === pEmail) ||
            (c?.secondaryEmail && c.secondaryEmail.toLowerCase().trim() === pEmail)
          );
          if (matched) {
            p.isExistingContact = true;
            p.existingLeadId = (lead._id ? lead._id.toString() : String(lead.id || leadId || ''));
            p.existingLeadName = lead.entity_name || lead.name;
            if (matched.name && (!p.name || p.name === p.email)) p.name = matched.name;
            if (matched.title && !p.title) p.title = matched.title;
            if (matched.phone && !p.phone) p.phone = matched.phone;
          }
        }
      }

      // 2. For participants not on this lead, batch query the brand's leads collection
      const unmatchedEmails = participants
        .filter((p) => !p.isExistingContact)
        .map((p) => p.email.toLowerCase().trim())
        .filter(Boolean);

      if (unmatchedEmails.length > 0) {
        const brandConfig = await getBrandConfig(brand).catch(() => null);
        const leadsCollectionName = brandConfig?.dbCollection || 'leads';
        const matchedLeads = await db
          .collection(leadsCollectionName)
          .find(
            {
              ...(tenantId ? { tenantId } : {}),
              $or: [
                { contactEmails: { $in: unmatchedEmails } },
                { 'contacts.email': { $in: unmatchedEmails } },
                { 'contacts.secondaryEmail': { $in: unmatchedEmails } },
              ],
            },
            {
              projection: {
                _id: 1,
                id: 1,
                entity_name: 1,
                name: 1,
                contacts: 1,
                contactEmails: 1,
              },
            }
          )
          .toArray()
          .catch(() => []);

        for (const p of participants) {
          if (p.isExistingContact) continue;
          const pEmail = p.email.toLowerCase().trim();
          const leadMatch = matchedLeads.find((ml) => {
            if (ml.contactEmails && Array.isArray(ml.contactEmails)) {
              if (ml.contactEmails.some((e: string) => e?.toLowerCase().trim() === pEmail)) return true;
            }
            if (ml.contacts && Array.isArray(ml.contacts)) {
              return ml.contacts.some((c: any) =>
                (c?.email && c.email.toLowerCase().trim() === pEmail) ||
                (c?.secondaryEmail && c.secondaryEmail.toLowerCase().trim() === pEmail)
              );
            }
            return false;
          });

          if (leadMatch) {
            p.isExistingContact = true;
            p.existingLeadId = leadMatch._id ? leadMatch._id.toString() : String(leadMatch.id || '');
            p.existingLeadName = leadMatch.entity_name || leadMatch.name;
            const matchedContact = leadMatch.contacts?.find((c: any) =>
              (c?.email && c.email.toLowerCase().trim() === pEmail) ||
              (c?.secondaryEmail && c.secondaryEmail.toLowerCase().trim() === pEmail)
            );
            if (matchedContact) {
              if (matchedContact.name && (!p.name || p.name === p.email)) p.name = matchedContact.name;
              if (matchedContact.title && !p.title) p.title = matchedContact.title;
              if (matchedContact.phone && !p.phone) p.phone = matchedContact.phone;
            }
          }
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Resolve userMailbox: if viewer email is provided, check if one of their mailboxes/aliases participated
  let resolvedUserMailbox: string | undefined = undefined;
  if (options.userEmail) {
    const viewerEmail = options.userEmail.toLowerCase().trim();
    const viewerAliases = await getUserAliases(db, viewerEmail).catch(() => [viewerEmail]);
    const viewerSet = new Set(viewerAliases.map((a) => a.toLowerCase().trim()));
    for (const m of messages) {
      if (m.userEmail && viewerSet.has(m.userEmail.toLowerCase().trim())) {
        resolvedUserMailbox = m.userEmail.toLowerCase().trim();
        break;
      }
      if (m.from && viewerSet.has(m.from.toLowerCase().trim())) {
        resolvedUserMailbox = m.from.toLowerCase().trim();
        break;
      }
      if (m.to) {
        const matchTo = m.to.find((t) => viewerSet.has(t.toLowerCase().trim()));
        if (matchTo) {
          resolvedUserMailbox = matchTo.toLowerCase().trim();
          break;
        }
      }
    }
  }

  if (!resolvedUserMailbox && options.userEmail) {
    resolvedUserMailbox = options.userEmail.toLowerCase().trim();
  }

  const thread: InboxThread = {
    id: threadId,
    leadId,
    leadName,
    leadStage,
    contactName,
    contactEmail,
    senderDisplayName,
    senderEmail,
    hasLead,
    hasContact,
    hasDeal,
    dealsCount,
    contactsCount,
    dealValue,
    subject,
    snippet,
    lastMessageAt: lastMessage.createdAt,
    lastMessageType: lastMessage.type,
    lastMessageDirection: lastMessage.direction,
    messageCount: messages.length,
    isRead,
    isStarred,
    isArchived,
    needsReply,
    streams: Array.from(streams),
    participants,
    userMailbox: resolvedUserMailbox,
  };

  return { thread, messages, lead, participants };
}

/**
 * Updates thread state flags (read, starred, archived).
 */
export async function setThreadStatus(
  db: Db,
  brand: string,
  tenantId: string,
  threadId: string,
  updates: { isRead?: boolean; isStarred?: boolean; isArchived?: boolean },
  userId?: string
): Promise<InboxThreadState> {
  await ensureInboxIndexes(db);
  const now = new Date().toISOString();

  const setFields: Record<string, any> = {
    updatedAt: now,
  };
  if (updates.isRead !== undefined) setFields.isRead = updates.isRead;
  if (updates.isStarred !== undefined) setFields.isStarred = updates.isStarred;
  if (updates.isArchived !== undefined) setFields.isArchived = updates.isArchived;

  await db.collection(INBOX_THREAD_STATES_COLLECTION).updateOne(
    {
      brand,
      threadId,
      ...(tenantId ? { tenantId } : {}),
    },
    {
      $set: setFields,
      $setOnInsert: {
        brand,
        threadId,
        tenantId,
        ...(userId ? { userId } : {}),
      },
    },
    { upsert: true }
  );

  return {
    brand,
    tenantId,
    threadId,
    userId,
    ...updates,
    updatedAt: now,
  };
}

export type InboxReplyPayload =
  | {
      kind: 'email';
      body: string;
      subject?: string;
      recipientEmail?: string;
      documentIds?: string[];
      includeSignature?: boolean;
      senderEmail?: string;
    }
  | {
      kind: 'note';
      text: string;
    };

/**
 * Sends an in-thread email reply or logs an internal team note.
 */
export async function postInboxReply(
  db: Db,
  brand: string,
  tenantId: string,
  threadId: string,
  payload: InboxReplyPayload,
  userContext: {
    userId?: string;
    userEmail?: string;
    userName?: string;
  }
): Promise<{ success: boolean; result?: AutomatedSendResult | any; error?: string }> {
  const detail = await getInboxThreadDetail(db, brand, tenantId, threadId, {
    userId: userContext?.userId,
    userEmail: userContext?.userEmail,
    markRead: false,
  });
  if (!detail.thread) {
    return { success: false, error: 'Conversation thread not found' };
  }

  const { thread, lead } = detail;
  if (!thread.leadId && payload.kind === 'email') {
    return { success: false, error: 'Cannot reply via email to a thread without an associated Lead' };
  }

  if (payload.kind === 'note') {
    const rawText = payload.text.trim();
    if (!rawText) return { success: false, error: 'Note text cannot be empty' };
    if (rawText.length > 10000) return { success: false, error: 'Note exceeds maximum length of 10,000 characters' };

    const now = new Date();
    await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
      leadId: thread.leadId,
      tenantId,
      brand,
      type: 'note',
      direction: null,
      matchedContactKey: null,
      bodyExcerpt: truncateBody(rawText, 5000),
      loggedBy: userContext.userEmail || userContext.userName || 'team',
      userId: userContext.userId,
      userEmail: userContext.userEmail,
      source: 'manual',
      threadId: threadId.startsWith('lead:') ? undefined : threadId,
      createdAt: now,
    });

    if (lead?._id) {
      const brandConfig = await getBrandConfig(brand).catch(() => null);
      const leadsCol = brandConfig?.dbCollection || 'leads';
      await db.collection(leadsCol).updateOne({ _id: lead._id }, { $set: { updatedAt: now } }).catch(() => {});
    }

    return { success: true };
  }

  if (payload.kind === 'email') {
    if (!payload.body || !payload.body.trim()) {
      return { success: false, error: 'Email reply body cannot be empty' };
    }

    // Resolve Lead document to construct LeadForSend
    const brandConfig = await getBrandConfig(brand).catch(() => null);
    const leadsCol = brandConfig?.dbCollection || 'leads';

    let resolvedLead: any = lead;
    if (!resolvedLead && thread.leadId) {
      const orClauses: any[] = [{ id: thread.leadId }];
      const num = Number(thread.leadId);
      if (!Number.isNaN(num)) orClauses.push({ id: num });
      if (ObjectId.isValid(thread.leadId)) {
        try {
          orClauses.push({ _id: new ObjectId(thread.leadId) });
        } catch {
          // ignore
        }
      }
      resolvedLead = await db.collection(leadsCol).findOne({
        $or: orClauses,
        ...(tenantId ? { tenantId } : {}),
      }).catch(() => null);
    }

    if (!resolvedLead) {
      return { success: false, error: 'Lead document could not be loaded for email dispatch' };
    }

    // Ensure contacts array contains the designated recipient
    const recipient = payload.recipientEmail || thread.contactEmail || resolvedLead.contacts?.[0]?.email;
    if (!recipient) {
      return { success: false, error: 'No recipient email address available for this lead' };
    }

    const contacts = Array.isArray(resolvedLead.contacts) ? [...resolvedLead.contacts] : [];
    const existingIndex = contacts.findIndex((c: any) => c?.email?.toLowerCase() === recipient.toLowerCase());
    if (existingIndex >= 0) {
      contacts[existingIndex] = { ...contacts[existingIndex], isDecisionMaker: true };
    } else {
      contacts.unshift({
        name: thread.contactName || 'Valued Contact',
        email: recipient,
        isDecisionMaker: true,
      });
    }

    const leadForSend: LeadForSend = {
      ...resolvedLead,
      _id: resolvedLead._id ? resolvedLead._id.toString() : thread.leadId,
      contacts,
    };

    // Determine threading headers
    const threadContext = await resolveLeadThreadContext(db, leadForSend._id, brand, tenantId).catch(() => null);
    const replySubject = payload.subject && payload.subject.trim()
      ? payload.subject.trim()
      : formatReSubject(thread.subject || threadContext?.subject);

    const syntheticTemplate: OutreachTemplate = {
      id: 'inbox-reply',
      name: 'Inbox Quick Reply',
      channel: 'email',
      industry: '',
      subject: replySubject,
      body: payload.body,
      variables: [],
    };

    const idempotencyKey = `inbox-reply-${thread.leadId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const rawThreadId = threadId.startsWith('lead:') || threadId.startsWith('msg:')
      ? threadContext?.threadId
      : threadId;
    const validGmailThreadId = rawThreadId && /^[0-9a-fA-F]{16,}$/.test(rawThreadId)
      ? rawThreadId
      : undefined;

    const sendResult = await sendManualEmail(db, leadForSend, syntheticTemplate, {
      brand,
      tenantId,
      idempotencyKey,
      documentIds: payload.documentIds,
      senderUserId: userContext.userId,
      senderName: userContext.userName,
      senderEmail: payload.senderEmail || userContext.userEmail,
      includeSignature: payload.includeSignature !== false,
      replyInThread: true,
      threadId: validGmailThreadId,
      inReplyTo: threadContext?.inReplyTo,
      references: threadContext?.references,
    });

    if (sendResult.sent) {
      await setThreadStatus(db, brand, tenantId, threadId, { isRead: true }, userContext.userId);
    }

    return {
      success: sendResult.sent,
      result: sendResult,
      error: sendResult.sent ? undefined : (sendResult.reason || 'Email send failed'),
    };
  }

  return { success: false, error: 'Unsupported reply kind' };
}
