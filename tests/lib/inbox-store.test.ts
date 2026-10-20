import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listInboxThreads,
  getInboxThreadDetail,
  setThreadStatus,
  postInboxReply,
  INBOX_THREAD_STATES_COLLECTION,
} from '../../app/lib/inbox-store';
import { ACTIVITY_LOG_COLLECTION } from '../../app/lib/activity-log-store';
import * as brandModule from '../../app/lib/brand';
import * as outreachSendModule from '../../lib/outreach-send';

vi.mock('../../app/lib/brand', async (importOriginal) => {
  const actual = await importOriginal<typeof brandModule>();
  return {
    ...actual,
    getBrandConfig: vi.fn().mockResolvedValue({
      label: 'CogMap',
      dbCollection: 'leads',
      currency: 'USD',
      aliases: ['cogmap'],
      ownNameTerms: ['cogmap'],
      forecastModel: 'dealSizeBand',
    }),
  };
});

describe('inbox-store (Issue 257: Unified Communication Center)', () => {
  let mockActivityDocs: any[] = [];
  let mockOutreachDocs: any[] = [];
  let mockStateDocs: any[] = [];
  let mockLeadDocs: any[] = [];
  let mockIntegrationDocs: any[] = [];
  let mockUserDocs: any[] = [];
  let mockCompanySettingsDoc: any = null;

  function createMockDb() {
    return {
      collection: (name: string) => {
        if (name === ACTIVITY_LOG_COLLECTION) {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: (query: any) => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => {
                    return mockActivityDocs.filter((d) => {
                      if (query.brand && d.brand !== query.brand) return false;
                      if (query.threadId && d.threadId !== query.threadId) return false;
                      if (query.leadId && d.leadId !== query.leadId) return false;
                      return true;
                    });
                  },
                }),
                toArray: async () => {
                  return mockActivityDocs.filter((d) => {
                    if (query.brand && d.brand !== query.brand) return false;
                    return true;
                  });
                },
              }),
            }),
            insertOne: async (doc: any) => {
              mockActivityDocs.push({ ...doc, _id: `act_${Date.now()}` });
              return { insertedId: `act_${Date.now()}` };
            },
          };
        }

        if (name === 'outreach_logs') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: (query: any) => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => {
                    return mockOutreachDocs.filter((d) => {
                      if (query.brand && d.brand !== query.brand) return false;
                      if (query.activityLogWritten && d.activityLogWritten === true) return false;
                      return true;
                    });
                  },
                }),
                toArray: async () => mockOutreachDocs,
              }),
            }),
          };
        }

        if (name === INBOX_THREAD_STATES_COLLECTION) {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: (query: any) => ({
              toArray: async () => {
                return mockStateDocs.filter((s) => {
                  if (query.brand && s.brand !== query.brand) return false;
                  if (query.threadId?.$in && !query.threadId.$in.includes(s.threadId)) return false;
                  return true;
                });
              },
            }),
            findOne: async (query: any) => {
              return mockStateDocs.find((s) => s.threadId === query.threadId && s.brand === query.brand) || null;
            },
            updateOne: async (query: any, update: any, options?: any) => {
              const existingIdx = mockStateDocs.findIndex(
                (s) => s.threadId === query.threadId && s.brand === query.brand
              );
              if (existingIdx >= 0) {
                mockStateDocs[existingIdx] = {
                  ...mockStateDocs[existingIdx],
                  ...update.$set,
                };
              } else if (options?.upsert) {
                mockStateDocs.push({
                  ...query,
                  ...update.$setOnInsert,
                  ...update.$set,
                });
              }
              return { acknowledged: true };
            },
          };
        }

        if (name === 'leads') {
          return {
            find: () => ({
              toArray: async () => mockLeadDocs,
            }),
            findOne: async (query: any) => {
              if (query.$or) {
                for (const clause of query.$or) {
                  const match = mockLeadDocs.find(
                    (l) => l.id === clause.id || String(l.id) === String(clause.id) || l._id === clause._id
                  );
                  if (match) return match;
                }
              }
              return mockLeadDocs[0] || null;
            },
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          };
        }

        if (name === 'integration_connections') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: (query: any) => ({
              toArray: async () => {
                return mockIntegrationDocs.filter((conn) => {
                  if (query.brand && conn.brand !== query.brand) return false;
                  if (query.status && conn.status !== query.status) return false;
                  if (query.$or) {
                    const match = query.$or.some((clause: any) => {
                      if (clause.userId?.$in && clause.userId.$in.includes(conn.userId)) return true;
                      if (clause.userId && clause.userId === conn.userId) return true;
                      if (clause.connectedBy?.$in && clause.connectedBy.$in.includes(conn.connectedBy)) return true;
                      if (clause.connectedBy && clause.connectedBy === conn.connectedBy) return true;
                      if (clause.userEmail?.$in && clause.userEmail.$in.includes(conn.userEmail)) return true;
                      if (clause.userEmail && clause.userEmail === conn.userEmail) return true;
                      return false;
                    });
                    if (!match) return false;
                  }
                  return true;
                });
              },
            }),
          };
        }

        if (name === 'sso_user_access') {
          return {
            find: (query: any) => ({
              toArray: async () => {
                return mockUserDocs.filter((u) => {
                  if (query.$or) {
                    return query.$or.some((clause: any) => {
                      if (clause.ssoUserId?.$in && clause.ssoUserId.$in.includes(u.ssoUserId)) return true;
                      if (clause.ssoUserId && clause.ssoUserId === u.ssoUserId) return true;
                      if (clause.email?.$in && clause.email.$in.includes(u.email)) return true;
                      if (clause.email && clause.email === u.email) return true;
                      if (clause.aliases?.$in && u.aliases?.some((a: string) => clause.aliases.$in.includes(a))) return true;
                      return false;
                    });
                  }
                  if (query?.email?.$in && !query.email.$in.includes(u.email)) return false;
                  return true;
                });
              },
            }),
          };
        }

        if (name === 'company_settings') {
          return {
            findOne: async () => mockCompanySettingsDoc,
          };
        }

        return {
          createIndex: vi.fn().mockResolvedValue('ok'),
          find: () => ({ toArray: async () => [] }),
          findOne: async () => null,
          updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock' }),
        };
      },
    } as any;
  }

  beforeEach(() => {
    mockActivityDocs = [];
    mockOutreachDocs = [];
    mockStateDocs = [];
    mockLeadDocs = [];
    mockIntegrationDocs = [];
    mockUserDocs = [];
    mockCompanySettingsDoc = null;
    vi.clearAllMocks();
  });

  describe('listInboxThreads', () => {
    it('returns empty list and zero counts when no messages exist', async () => {
      const db = createMockDb();
      const res = await listInboxThreads(db, 'cogmap', 't_default', { userEmail: 'sales@cogmap.com' });

      expect(res.threads).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.counts).toEqual({
        all: 0,
        inbox: 0,
        sent: 0,
        needs_reply: 0,
        internal: 0,
        calls: 0,
        system: 0,
        unread: 0,
      });
    });

    it('clusters messages by threadId and merges activityLog and outreach_logs', async () => {
      const db = createMockDb();

      mockLeadDocs = [
        {
          _id: 'lead_1',
          id: 'lead_1',
          entity_name: 'FC Bayern Analytics',
          kanbanColumn: 'negotiating',
          contacts: [{ name: 'Thomas Mueller', email: 'thomas@fcbayern.de' }],
          deals: [{ amount: 45000 }],
        },
      ];

      // 1. Initial outbound email in outreach_logs
      mockOutreachDocs.push({
        _id: 'out_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        gmailThreadId: 'thread_100',
        subject: 'Partnership proposal',
        body: 'Hi Thomas, check out our sports intelligence solution.',
        createdAt: new Date('2026-10-18T10:00:00Z'),
        from: 'sales@cogmap.com',
        to: 'thomas@fcbayern.de',
      });

      // 2. Inbound reply in activityLog
      mockActivityDocs.push({
        _id: 'act_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        threadId: 'thread_100',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Re: Partnership proposal',
        bodyExcerpt: 'Sounds interesting. Can you send over a quote?',
        fromAddress: 'thomas@fcbayern.de',
        toAddresses: ['sales@cogmap.com'],
        createdAt: new Date('2026-10-18T12:00:00Z'),
      });

      const res = await listInboxThreads(db, 'cogmap', 't_default', { userEmail: 'sales@cogmap.com' });

      expect(res.total).toBe(1);
      expect(res.threads.length).toBe(1);

      const thread = res.threads[0];
      expect(thread.id).toBe('thread_100');
      expect(thread.leadName).toBe('FC Bayern Analytics');
      expect(thread.leadStage).toBe('negotiating');
      expect(thread.contactName).toBe('Thomas Mueller');
      expect(thread.messageCount).toBe(2);
      expect(thread.lastMessageType).toBe('email-inbound');
      expect(thread.lastMessageDirection).toBe('inbound');
      expect(thread.needsReply).toBe(true);
      expect(thread.isRead).toBe(false); // inbound default is unread
      expect(thread.streams).toContain('all');
      expect(thread.streams).toContain('inbox');
      expect(thread.streams).toContain('sent');
      expect(thread.streams).toContain('needs_reply');

      expect(res.counts.all).toBe(1);
      expect(res.counts.inbox).toBe(1);
      expect(res.counts.sent).toBe(1);
      expect(res.counts.needs_reply).toBe(1);
      expect(res.counts.unread).toBe(1);
    });

    it('correctly filters by streams and respects stored thread status', async () => {
      const db = createMockDb();

      mockLeadDocs = [
        { _id: 'lead_1', id: 'lead_1', entity_name: 'Lead Alpha', contacts: [] },
        { _id: 'lead_2', id: 'lead_2', entity_name: 'Lead Beta', contacts: [] },
      ];

      // Thread 1: Inbound email
      mockActivityDocs.push({
        _id: 'act_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        threadId: 'thread_alpha',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Alpha inquiry',
        bodyExcerpt: 'Alpha text',
        to: ['rep@cogmap.com'],
        createdAt: new Date('2026-10-18T10:00:00Z'),
      });

      // Thread 2: Internal note
      mockActivityDocs.push({
        _id: 'act_2',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_2',
        threadId: 'thread_beta',
        type: 'note',
        direction: null,
        bodyExcerpt: 'Called them, left voicemail on mobile',
        userEmail: 'rep@cogmap.com',
        loggedBy: 'rep@cogmap.com',
        createdAt: new Date('2026-10-18T11:00:00Z'),
      });

      // Store Thread 1 as starred and read
      mockStateDocs.push({
        brand: 'cogmap',
        tenantId: 't_default',
        threadId: 'thread_alpha',
        isRead: true,
        isStarred: true,
        isArchived: false,
      });

      // List all
      const allRes = await listInboxThreads(db, 'cogmap', 't_default', { userEmail: 'rep@cogmap.com' });
      expect(allRes.total).toBe(2);
      expect(allRes.counts.internal).toBe(1);
      expect(allRes.counts.inbox).toBe(1);
      expect(allRes.counts.unread).toBe(0); // alpha was explicitly marked read; beta is internal note (read by default)

      // Filter by stream: internal
      const internalRes = await listInboxThreads(db, 'cogmap', 't_default', { stream: 'internal', userEmail: 'rep@cogmap.com' });
      expect(internalRes.total).toBe(1);
      expect(internalRes.threads[0].id).toBe('thread_beta');

      // Filter by starred
      const starredRes = await listInboxThreads(db, 'cogmap', 't_default', { starredOnly: true, userEmail: 'rep@cogmap.com' });
      expect(starredRes.total).toBe(1);
      expect(starredRes.threads[0].id).toBe('thread_alpha');

      // Search query
      const searchRes = await listInboxThreads(db, 'cogmap', 't_default', { search: 'voicemail', userEmail: 'rep@cogmap.com' });
      expect(searchRes.total).toBe(1);
      expect(searchRes.threads[0].id).toBe('thread_beta');

      // Search query by leadId
      const leadIdSearchRes = await listInboxThreads(db, 'cogmap', 't_default', { search: 'lead_1', userEmail: 'rep@cogmap.com' });
      expect(leadIdSearchRes.total).toBe(1);
      expect(leadIdSearchRes.threads[0].id).toBe('thread_alpha');
    });

    it('enforces My Inbox scoping and disables Team Inbox', async () => {
      const db = createMockDb();

      mockIntegrationDocs = [
        {
          _id: 'conn_1',
          brand: 'cogmap',
          userEmail: 'alice@cogmap.com',
          status: 'active',
          metadata: { email: 'alice@cogmap.com', displayName: 'Alice Rep' },
        },
        {
          _id: 'conn_2',
          brand: 'cogmap',
          userEmail: 'bob@cogmap.com',
          status: 'active',
          metadata: { email: 'bob@cogmap.com', displayName: 'Bob Rep' },
        },
      ];

      mockLeadDocs = [
        {
          _id: 'lead_b',
          id: 'lead_b',
          entity_name: 'Prospect B Corp',
        },
      ];

      // Thread 1: Inbound message synced by Alice's mailbox (unlinked private thread)
      mockActivityDocs.push({
        _id: 'act_alice',
        brand: 'cogmap',
        tenantId: 't_default',
        threadId: 'thread_alice_lead',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Interest from Prospect A',
        bodyExcerpt: 'Can we chat?',
        from: 'prospect_a@client.com',
        userEmail: 'alice@cogmap.com',
        createdAt: new Date('2026-10-19T10:00:00Z'),
      });

      // Thread 2: Inbound message synced by Bob's mailbox (linked to CRM lead)
      mockActivityDocs.push({
        _id: 'act_bob',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_b',
        threadId: 'thread_bob_lead',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Interest from Prospect B',
        bodyExcerpt: 'Send pricing please',
        from: 'prospect_b@client.com',
        userEmail: 'bob@cogmap.com',
        createdAt: new Date('2026-10-19T11:00:00Z'),
      });

      // When Alice views her inbox (userEmail: 'alice@cogmap.com')
      const aliceInbox = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'alice@cogmap.com',
        scope: 'my',
      });

      expect(aliceInbox.threads.length).toBe(1);
      expect(aliceInbox.threads[0].id).toBe('thread_alice_lead');
      expect(aliceInbox.threads[0].userMailbox).toBe('alice@cogmap.com');
      expect(aliceInbox.threads[0].isMyInbox).toBe(true);
      expect(aliceInbox.counts.all).toBe(1);
      expect(aliceInbox.activeScope).toBe('my');

      // When Bob views his inbox
      const bobInbox = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'bob@cogmap.com',
        scope: 'my',
      });

      expect(bobInbox.threads.length).toBe(1);
      expect(bobInbox.threads[0].id).toBe('thread_bob_lead');
      expect(bobInbox.threads[0].userMailbox).toBe('bob@cogmap.com');
      expect(bobInbox.threads[0].isMyInbox).toBe(true);
      expect(bobInbox.activeScope).toBe('my');

      // Team Inbox is disabled: even if scope: 'team' is requested, it strictly enforces 'my' scope
      const teamAttempt = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'alice@cogmap.com',
        scope: 'team' as any,
      });

      // Alice only sees her own thread; Bob's thread is strictly isolated
      expect(teamAttempt.threads.length).toBe(1);
      expect(teamAttempt.threads[0].id).toBe('thread_alice_lead');
      expect(teamAttempt.activeScope).toBe('my');
      expect(teamAttempt.mailboxes.length).toBe(1);
      expect(teamAttempt.mailboxes[0].email).toBe('alice@cogmap.com');
    });

    it('links multi-identity accounts (e.g. personal Google and corporate Workspace mailboxes)', async () => {
      const db = createMockDb();

      mockUserDocs = [
        { ssoUserId: 'uid_csaba_google', email: 'moldovancsaba@gmail.com', name: 'Moldovan Csaba' },
        { ssoUserId: 'uid_csaba_corp', email: 'coo@seyuselfies.com', name: 'Csaba Zoltán Moldován' },
      ];

      mockIntegrationDocs = [
        {
          _id: 'conn_csaba_google',
          provider: 'gmail',
          brand: 'seyu',
          userId: 'uid_csaba_google',
          userEmail: 'moldovancsaba@gmail.com',
          status: 'active',
        },
        {
          _id: 'conn_csaba_corp',
          provider: 'gmail',
          brand: 'seyu',
          userId: 'uid_csaba_corp',
          userEmail: 'coo@seyuselfies.com',
          status: 'active',
        },
      ];

      // Thread 1 synced from coo@seyuselfies.com
      mockActivityDocs.push({
        _id: 'act_corp',
        brand: 'seyu',
        tenantId: 't_default',
        threadId: 'thread_corp',
        type: 'email-outbound',
        direction: 'outbound',
        subject: 'Corporate Partnership Follow-up',
        bodyExcerpt: 'Following up on our call',
        from: 'coo@seyuselfies.com',
        userEmail: 'coo@seyuselfies.com',
        userId: 'uid_csaba_corp',
        createdAt: new Date('2026-10-19T10:00:00Z'),
      });

      // Thread 2 synced from moldovancsaba@gmail.com
      mockActivityDocs.push({
        _id: 'act_google',
        brand: 'seyu',
        tenantId: 't_default',
        threadId: 'thread_google',
        type: 'email-outbound',
        direction: 'outbound',
        subject: 'Direct Executive Note',
        bodyExcerpt: 'Direct note',
        from: 'moldovancsaba@gmail.com',
        userEmail: 'moldovancsaba@gmail.com',
        userId: 'uid_csaba_google',
        createdAt: new Date('2026-10-19T11:00:00Z'),
      });

      // When logged in via Google SSO as moldovancsaba@gmail.com
      const res = await listInboxThreads(db, 'seyu', 't_default', {
        userId: 'uid_csaba_google',
        userEmail: 'moldovancsaba@gmail.com',
        scope: 'my',
      });

      // Both threads are seamlessly included under My Inbox
      expect(res.threads.length).toBe(2);
      expect(res.threads.map((t) => t.id).sort()).toEqual(['thread_corp', 'thread_google']);
      expect(res.counts.all).toBe(2);
    });

    it('enforces fail-closed privacy guard when neither userId nor userEmail is provided', async () => {
      const db = createMockDb();

      mockActivityDocs.push({
        _id: 'act_secret',
        brand: 'seyu',
        tenantId: 't_default',
        threadId: 'thread_secret',
        type: 'email-outbound',
        direction: 'outbound',
        subject: 'Confidential Negotiations',
        bodyExcerpt: 'Private team correspondence',
        from: 'rep@seyuselfies.com',
        userEmail: 'rep@seyuselfies.com',
        createdAt: new Date(),
      });

      // Calling listInboxThreads without user identity fails closed immediately
      const res = await listInboxThreads(db, 'seyu', 't_default');

      expect(res.threads).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.counts.all).toBe(0);
    });

    it('enforces strict mailbox isolation by default, ignoring assigned leads unless enabled in company_settings', async () => {
      const db = createMockDb();

      mockLeadDocs = [
        {
          _id: 'lead_assigned',
          id: 'lead_assigned',
          entity_name: 'Assigned Prospect Inc',
          assignedToEmail: 'myrep@cogmap.com',
          assignedTo: 'uid_myrep',
        },
      ];

      // A colleague emailed this assigned lead
      mockActivityDocs.push({
        _id: 'act_other_colleague',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_assigned',
        threadId: 'thread_other_colleague',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Discussion with colleague',
        bodyExcerpt: 'Colleague conversation',
        from: 'prospect@assignedinc.com',
        to: ['colleague@cogmap.com'],
        userEmail: 'colleague@cogmap.com',
        createdAt: new Date(),
      });

      // 1. By default, companySettings has includeAssignedLeadThreads = false (Strict Mailbox Only)
      mockCompanySettingsDoc = {
        brand: 'cogmap',
        inboxSettings: { includeAssignedLeadThreads: false },
      };

      const strictRes = await listInboxThreads(db, 'cogmap', 't_default', {
        userId: 'uid_myrep',
        userEmail: 'myrep@cogmap.com',
      });

      // Thread is NOT included in myrep's inbox because myrep was not an email participant
      expect(strictRes.threads.length).toBe(0);

      // 2. When companySettings has includeAssignedLeadThreads = true
      mockCompanySettingsDoc = {
        brand: 'cogmap',
        inboxSettings: { includeAssignedLeadThreads: true },
      };

      const permissiveRes = await listInboxThreads(db, 'cogmap', 't_default', {
        userId: 'uid_myrep',
        userEmail: 'myrep@cogmap.com',
      });

      // Thread is now visible to lead owner
      expect(permissiveRes.threads.length).toBe(1);
      expect(permissiveRes.threads[0].id).toBe('thread_other_colleague');
    });

    it('enforces includeCcThreads policy: excludes CC-only threads by default unless enabled', async () => {
      const db = createMockDb();

      // Thread where colleague emailed prospect and CC'd manager
      mockActivityDocs.push({
        _id: 'act_cc_thread',
        brand: 'cogmap',
        tenantId: 't_default',
        threadId: 'thread_cc_only',
        type: 'email-outbound',
        direction: 'outbound',
        subject: 'Event planning update',
        bodyExcerpt: 'Here is the plan',
        from: 'colleague@cogmap.com',
        to: ['prospect@eventclient.com'],
        cc: ['manager@cogmap.com'],
        userEmail: 'colleague@cogmap.com',
        createdAt: new Date(),
      });

      // 1. By default, includeCcThreads is false (strict direct participation)
      mockCompanySettingsDoc = {
        brand: 'cogmap',
        inboxSettings: { includeCcThreads: false },
      };

      const strictRes = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'manager@cogmap.com',
      });
      // Manager is only on CC, so thread is NOT in manager's personal inbox
      expect(strictRes.threads.length).toBe(0);

      // 2. When includeCcThreads is true
      mockCompanySettingsDoc = {
        brand: 'cogmap',
        inboxSettings: { includeCcThreads: true },
      };

      const permissiveRes = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'manager@cogmap.com',
      });
      // Manager now sees CC thread, and userMailbox resolves to manager's email (not colleague)
      expect(permissiveRes.threads.length).toBe(1);
      expect(permissiveRes.threads[0].userMailbox).toBe('manager@cogmap.com');
    });

    it('resolves external recipient as counterparty for outbound-only threads', async () => {
      const db = createMockDb();

      mockActivityDocs.push({
        _id: 'act_outbound_only',
        brand: 'cogmap',
        tenantId: 't_default',
        threadId: 'thread_outbound_only',
        type: 'email-outbound',
        direction: 'outbound',
        subject: 'Selfie Event Setup',
        bodyExcerpt: 'Details for Saturday',
        from: 'rep@cogmap.com',
        to: ['inga.schuler@scb.ch'],
        userEmail: 'rep@cogmap.com',
        createdAt: new Date(),
      });

      const res = await listInboxThreads(db, 'cogmap', 't_default', {
        userEmail: 'rep@cogmap.com',
      });

      expect(res.threads.length).toBe(1);
      const thread = res.threads[0];
      // Counterparty must be external recipient (Inga Schuler), NEVER the rep who sent it
      expect(thread.senderEmail).toBe('inga.schuler@scb.ch');
      expect(thread.contactEmail).toBe('inga.schuler@scb.ch');
      expect(thread.senderDisplayName).toContain('Inga Schuler');
    });

    it('dynamically resolves admin-configured aliases from sso_user_access', async () => {
      const db = createMockDb();

      mockUserDocs = [
        {
          ssoUserId: 'uid_sarah',
          email: 'sarah.personal@gmail.com',
          aliases: ['sarah@corporate.com', 'helpdesk@corporate.com'],
        },
      ];

      mockActivityDocs.push({
        _id: 'act_alias_thread',
        brand: 'cogmap',
        tenantId: 't_default',
        threadId: 'thread_alias_helpdesk',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Helpdesk ticket 402',
        bodyExcerpt: 'Inbound to helpdesk',
        from: 'client@external.com',
        to: ['helpdesk@corporate.com'],
        userEmail: 'helpdesk@corporate.com',
        createdAt: new Date(),
      });

      // Sarah signs in with personal email
      const res = await listInboxThreads(db, 'cogmap', 't_default', {
        userId: 'uid_sarah',
        userEmail: 'sarah.personal@gmail.com',
      });

      // Dynamic alias resolution united helpdesk@corporate.com into her inbox
      expect(res.threads.length).toBe(1);
      expect(res.threads[0].id).toBe('thread_alias_helpdesk');
    });
  });

  describe('getInboxThreadDetail & setThreadStatus', () => {
    it('retrieves detailed message list and updates read state', async () => {
      const db = createMockDb();

      mockLeadDocs = [{ _id: 'lead_1', id: 'lead_1', entity_name: 'Lead Gamma' }];

      mockActivityDocs.push({
        _id: 'act_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        threadId: 'thread_gamma',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Meeting request',
        bodyExcerpt: 'Can we talk on Thursday?',
        createdAt: new Date('2026-10-18T14:00:00Z'),
      });

      // Retrieve detail with markRead: true
      const detail = await getInboxThreadDetail(db, 'cogmap', 't_default', 'thread_gamma', { markRead: true });

      expect(detail.thread).toBeDefined();
      expect(detail.thread?.leadName).toBe('Lead Gamma');
      expect(detail.thread?.isRead).toBe(true);
      expect(detail.messages.length).toBe(1);

      // Verify thread status was persisted in mockStateDocs
      const savedState = mockStateDocs.find((s) => s.threadId === 'thread_gamma');
      expect(savedState?.isRead).toBe(true);

      // Star thread
      await setThreadStatus(db, 'cogmap', 't_default', 'thread_gamma', { isStarred: true });
      const updatedState = mockStateDocs.find((s) => s.threadId === 'thread_gamma');
      expect(updatedState?.isStarred).toBe(true);
    });

    it('isolates multi-company participants and does not auto-merge different-company participants into lead', async () => {
      const db = createMockDb();

      mockLeadDocs = [
        {
          _id: 'lead_frh',
          id: 'lead_frh',
          entity_name: 'FRH',
          url: 'https://frh.ro',
          contacts: [{ name: 'Kitty Erdei', email: 'kitty.erdei@frh.ro' }],
        },
      ];

      mockActivityDocs.push({
        _id: 'act_multi',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_frh',
        threadId: 'thread_multi_org',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Partnership discussion',
        from: 'kitty.erdei@frh.ro',
        to: ['tamas.sebestyen@seyuselfies.com'],
        cc: ['partner@externalagency.com', 'radu.popescu@frh.ro'],
        body: 'Hello team, let us review the schedule.',
        createdAt: new Date('2026-10-18T15:00:00Z'),
      });

      const detail = await getInboxThreadDetail(db, 'cogmap', 't_default', 'thread_multi_org');
      expect(detail.thread).toBeDefined();
      expect(detail.participants.length).toBeGreaterThanOrEqual(3);

      // Verify that the lead's contacts only contains same-domain contacts (frh.ro) and NOT externalagency.com or seyuselfies.com
      const leadContacts = detail.lead?.contacts || [];
      const seyContacts = leadContacts.filter((c: any) => c.email.includes('seyuselfies.com'));
      expect(seyContacts).toHaveLength(0);
      const agencyContacts = leadContacts.filter((c: any) => c.email.includes('externalagency.com'));
      expect(agencyContacts).toHaveLength(0);
      expect(leadContacts.some((c: any) => c.email === 'radu.popescu@frh.ro')).toBe(true);
    });
  });

  describe('postInboxReply', () => {
    it('posts an internal note to activityLog', async () => {
      const db = createMockDb();

      mockLeadDocs = [{ _id: 'lead_1', id: 'lead_1', entity_name: 'Delta Corp' }];
      mockActivityDocs.push({
        _id: 'act_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        threadId: 'thread_delta',
        type: 'note',
        bodyExcerpt: 'Initial observation',
        createdAt: new Date(),
      });

      const replyRes = await postInboxReply(
        db,
        'cogmap',
        't_default',
        'thread_delta',
        { kind: 'note', text: 'Spoke with CFO, agreed on next steps.' },
        { userEmail: 'rep@cogmap.com', userName: 'Sales Rep' }
      );

      expect(replyRes.success).toBe(true);
      const insertedNote = mockActivityDocs.find((d) => d.bodyExcerpt === 'Spoke with CFO, agreed on next steps.');
      expect(insertedNote).toBeDefined();
      expect(insertedNote?.loggedBy).toBe('rep@cogmap.com');
      expect(insertedNote?.type).toBe('note');
    });

    it('dispatches an in-thread email reply via sendManualEmail', async () => {
      const db = createMockDb();

      mockLeadDocs = [
        {
          _id: 'lead_1',
          id: 'lead_1',
          entity_name: 'Epsilon Tech',
          contacts: [{ name: 'Alex Smith', email: 'alex@epsilon.com', isDecisionMaker: true }],
        },
      ];

      mockActivityDocs.push({
        _id: 'act_1',
        brand: 'cogmap',
        tenantId: 't_default',
        leadId: 'lead_1',
        threadId: 'thread_eps',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Pricing query',
        bodyExcerpt: 'What is your annual tier?',
        createdAt: new Date(),
      });

      const spySendManualEmail = vi.spyOn(outreachSendModule, 'sendManualEmail').mockResolvedValue({
        sent: true,
        outreachLogId: 'out_log_new',
        resendEmailId: 'resend_123',
      });

      const replyRes = await postInboxReply(
        db,
        'cogmap',
        't_default',
        'thread_eps',
        {
          kind: 'email',
          body: 'Hi Alex, our tier is $15k per year.',
          subject: 'Re: Pricing query',
        },
        { userId: 'user_1', userEmail: 'rep@cogmap.com', userName: 'Sales Rep' }
      );

      expect(replyRes.success).toBe(true);
      expect(spySendManualEmail).toHaveBeenCalledTimes(1);

      const callArgs = spySendManualEmail.mock.calls[0];
      const leadArg = callArgs[1];
      const templateArg = callArgs[2];
      const contextArg = callArgs[3];

      expect(leadArg._id).toBe('lead_1');
      expect(templateArg?.subject).toBe('Re: Pricing query');
      expect(templateArg?.body).toBe('Hi Alex, our tier is $15k per year.');
      expect(contextArg.replyInThread).toBe(true);
      expect(contextArg.senderUserId).toBe('user_1');
    });
  });
});
