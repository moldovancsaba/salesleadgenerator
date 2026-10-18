import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { ACTIVITY_LOG_COLLECTION, truncateBody, ensureActivityLogIndexes } from './activity-log-store';
import { getBrandConfig } from './brand';
import { sendManualEmail, type LeadForSend, type AutomatedSendResult } from '../../lib/outreach-send';
import { formatReSubject, resolveLeadThreadContext } from '../../lib/gmail-threading';
import type { OutreachTemplate } from './outreach/default-templates';

export const INBOX_THREAD_STATES_COLLECTION = 'inbox_thread_states';

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
  streams: InboxStream[];
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

export interface InboxListOptions {
  stream?: InboxStream;
  search?: string;
  starredOnly?: boolean;
  unreadOnly?: boolean;
  archivedOnly?: boolean;
  userId?: string;
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
  if (doc.leadId !== undefined && doc.leadId !== null && String(doc.leadId).trim() !== '') {
    return `lead:${String(doc.leadId).trim()}`;
  }
  return `msg:${doc._id ? doc._id.toString() : String(Math.random())}`;
}

/**
 * Normalizes an activityLog record into an InboxMessage.
 */
function mapActivityToInboxMessage(doc: any): InboxMessage {
  const threadId = resolveMessageThreadId(doc);
  const bodyText = doc.bodyExcerpt || doc.text || doc.notes || doc.body || '';
  return {
    id: doc._id ? doc._id.toString() : String(Math.random()),
    threadId,
    leadId: doc.leadId ? String(doc.leadId) : '',
    type: doc.type || 'system',
    direction: doc.direction ?? null,
    subject: doc.subject || undefined,
    body: bodyText,
    from: doc.fromAddress || doc.from,
    to: Array.isArray(doc.toAddresses) ? doc.toAddresses : doc.to ? [doc.to] : undefined,
    cc: Array.isArray(doc.ccAddresses) ? doc.ccAddresses : undefined,
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
  };
}

/**
 * Normalizes an outreach_logs record into an InboxMessage.
 */
function mapOutreachToInboxMessage(log: any): InboxMessage {
  const threadId = resolveMessageThreadId(log);
  return {
    id: log._id ? log._id.toString() : String(Math.random()),
    threadId,
    leadId: log.leadId ? String(log.leadId) : '',
    type: 'email-outbound',
    direction: 'outbound',
    subject: log.subject || undefined,
    body: log.body || '',
    from: log.from,
    to: log.to ? [log.to] : undefined,
    createdAt: (log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt || Date.now())).toISOString(),
    source: log.source || 'outreach-log',
    rfcMessageId: log.rfcMessageId,
    inReplyTo: log.inReplyTo,
    references: log.references,
    openCount: log.openCount,
    clickCount: log.clickCount,
  };
}

/**
 * Lists conversation threads aggregated from activityLog and outreach_logs,
 * merged with thread read/starred/archived states and lead details.
 */
export async function listInboxThreads(
  db: Db,
  brand: string,
  tenantId: string,
  options: InboxListOptions = {}
): Promise<{ threads: InboxThread[]; counts: InboxCounts; total: number }> {
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
    };
  }

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

  for (const [threadId, msgs] of messagesByThread.entries()) {
    // Sort messages chronologically oldest to newest
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const lastMessage = msgs[msgs.length - 1];
    const threadLeadId = msgs.find((m) => m.leadId)?.leadId || '';
    const lead = threadLeadId ? leadLookup.get(threadLeadId) : null;

    const leadName = lead?.entity_name || lead?.name || (threadLeadId ? `Lead #${threadLeadId.slice(-6)}` : 'System Communications');
    const leadStage = lead?.kanbanColumn || lead?.status || undefined;
    const contact = lead?.contacts?.[0];
    const contactName = contact?.name || undefined;
    const contactEmail = contact?.email || undefined;
    const dealValue = lead?.deals?.[0]?.amount || lead?.estimated_annual_revenue_usd || lead?.ticketSizeEstimate?.estimatedValue || undefined;

    const subject = lastMessage.subject || msgs.slice().reverse().find((m) => m.subject)?.subject || 'No Subject';
    const snippet = truncateBody(lastMessage.body, 140) || '';

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

    // Needs reply: prospect sent the latest message and it's inbound email
    const needsReply = lastMessage.direction === 'inbound' && lastMessage.type === 'email-inbound';
    if (needsReply) {
      streams.add('needs_reply');
    }

    const state = stateByThread.get(threadId);
    const defaultUnread = lastMessage.direction === 'inbound';
    const isRead = state?.isRead !== undefined ? Boolean(state.isRead) : !defaultUnread;
    const isStarred = Boolean(state?.isStarred);
    const isArchived = Boolean(state?.isArchived);

    allThreads.push({
      id: threadId,
      leadId: threadLeadId,
      leadName,
      leadStage,
      contactName,
      contactEmail,
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
    });
  }

  // 6. Compute counts across unarchived threads
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

  for (const t of allThreads) {
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

  // 7. Filter threads according to requested options
  let filtered = allThreads;

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
        (t.contactEmail && t.contactEmail.toLowerCase().includes(q))
      );
    });
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const total = filtered.length;
  const offset = Math.max(0, options.offset || 0);
  const limit = Math.max(1, Math.min(200, options.limit || 50));
  const paged = filtered.slice(offset, offset + limit);

  return {
    threads: paged,
    counts,
    total,
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
  options: { userId?: string; markRead?: boolean } = {}
): Promise<{ thread: InboxThread | null; messages: InboxMessage[]; lead: any | null }> {
  await ensureInboxIndexes(db);
  await ensureActivityLogIndexes(db);

  const brandFilter: Record<string, any> = { brand };
  if (tenantId) brandFilter.tenantId = tenantId;

  // Build filter for messages in this thread
  const isLeadThread = threadId.startsWith('lead:');
  const targetLeadId = isLeadThread ? threadId.replace(/^lead:/, '') : undefined;

  const activityFilter: Record<string, any> = { ...brandFilter };
  const outreachFilter: Record<string, any> = { ...brandFilter, activityLogWritten: { $ne: true } };

  if (isLeadThread && targetLeadId) {
    activityFilter.$or = [{ threadId }, { leadId: targetLeadId }];
    outreachFilter.$or = [{ gmailThreadId: threadId }, { leadId: targetLeadId }];
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
    return { thread: null, messages: [], lead: null };
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

  const leadName = lead?.entity_name || lead?.name || (leadId ? `Lead #${leadId.slice(-6)}` : 'System Communications');
  const leadStage = lead?.kanbanColumn || lead?.status || undefined;
  const contact = lead?.contacts?.[0];
  const contactName = contact?.name || undefined;
  const contactEmail = contact?.email || undefined;
  const dealValue = lead?.deals?.[0]?.amount || lead?.estimated_annual_revenue_usd || lead?.ticketSizeEstimate?.estimatedValue || undefined;

  const subject = lastMessage.subject || messages.slice().reverse().find((m) => m.subject)?.subject || 'No Subject';
  const snippet = truncateBody(lastMessage.body, 140) || '';

  const streams = new Set<InboxStream>(['all']);
  for (const m of messages) {
    if (m.type === 'email-inbound') streams.add('inbox');
    if (m.type === 'email-outbound') streams.add('sent');
    if (m.type === 'note') streams.add('internal');
    if (m.type === 'call') streams.add('calls');
    if (m.type === 'system' || m.type === 'meeting-scheduled') streams.add('system');
  }

  const needsReply = lastMessage.direction === 'inbound' && lastMessage.type === 'email-inbound';
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

  const thread: InboxThread = {
    id: threadId,
    leadId,
    leadName,
    leadStage,
    contactName,
    contactEmail,
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
  };

  return { thread, messages, lead };
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
  const detail = await getInboxThreadDetail(db, brand, tenantId, threadId, { markRead: false });
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
      threadId: threadId.startsWith('lead:') ? threadContext?.threadId : threadId,
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
