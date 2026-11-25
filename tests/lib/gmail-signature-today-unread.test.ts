import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  appendSignatureToBody,
  fetchGmailSignatureFromGoogle,
  resolveSignatureForSender,
} from '../../lib/gmail-signature';
import { listInboxThreads, postInboxReply, setThreadStatus } from '../../app/lib/inbox-store';
import { getTodayViewData } from '../../lib/today-query';
import { getGmailSyncHealth, GMAIL_SYNC_CURSORS_COLLECTION } from '../../app/lib/gmail-sync-store';
import { ACTIVITY_LOG_COLLECTION } from '../../app/lib/activity-log-store';

vi.mock('../../app/lib/brand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/lib/brand')>();
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

describe('Gmail sendAs signatures, CRM badge matching, and Today unread inbox tile (issue 357)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('fetches primary and sendAs alias signatures, switches by sender, and appends signature once', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sendAs: [
            {
              sendAsEmail: 'alex@company.com',
              displayName: 'Alex Primary',
              isPrimary: true,
              isDefault: false,
              signature: '<p>Alex Primary — Account Exec</p>',
            },
            {
              sendAsEmail: 'sales@brand-alias.com',
              displayName: 'Alex Partnerships',
              isPrimary: false,
              isDefault: true,
              signature: '<div>Alex Partnerships<br/>Brand Partnerships</div>',
            },
          ],
        }),
        { status: 200 }
      )
    ) as any;

    const fetched = await fetchGmailSignatureFromGoogle('token-123', 'alex@company.com');
    expect(fetched).not.toBeNull();
    expect(Object.keys(fetched!.byEmail)).toEqual(['alex@company.com', 'sales@brand-alias.com']);

    const conn = {
      userEmail: 'alex@company.com',
      signatureHtml: fetched!.signatureHtml,
      signatureText: fetched!.signatureText,
      sendAsSignatures: fetched!.byEmail,
    };

    const primaryResolved = resolveSignatureForSender(conn, 'alex@company.com');
    expect(primaryResolved.fromEmail).toBe('alex@company.com');
    expect(primaryResolved.signatureText).toBe('Alex Primary — Account Exec');

    const aliasResolved = resolveSignatureForSender(conn, 'sales@brand-alias.com');
    expect(aliasResolved.fromEmail).toBe('sales@brand-alias.com');
    expect(aliasResolved.displayName).toBe('Alex Partnerships');
    expect(aliasResolved.signatureText).toContain('Brand Partnerships');

    // Idempotent signature appending: never duplicates if called twice
    const once = appendSignatureToBody('Hi Jordan,\n\nSharing the proposal.', aliasResolved.signatureText);
    const twice = appendSignatureToBody(once, aliasResolved.signatureText);
    expect(twice).toBe(once);
    expect((twice.match(/Brand Partnerships/g) || []).length).toBe(1);
  });

  it('reconciles Today unread tile with Inbox unread stream, honors gmailUnread, updates on read, and flags CRM leads', async () => {
    const activityDocs: any[] = [
      {
        _id: 'act_crm_unread',
        brand: 'cogmap',
        tenantId: 'default',
        threadId: '18f0000000000001',
        leadId: null,
        type: 'email-inbound',
        direction: 'inbound',
        fromAddress: 'vp@knownclub.com',
        toAddresses: ['rep@company.com'],
        subject: 'Re: Sponsorship package',
        bodyExcerpt: 'Let us schedule a call.',
        gmailUnread: true,
        userId: 'user-1',
        userEmail: 'rep@company.com',
        createdAt: new Date('2026-11-25T10:00:00Z'),
      },
      {
        _id: 'act_noncrm_unread',
        brand: 'cogmap',
        tenantId: 'default',
        threadId: '18f0000000000002',
        leadId: null,
        type: 'email-inbound',
        direction: 'inbound',
        fromAddress: 'vendor@events.io',
        toAddresses: ['rep@company.com'],
        subject: 'Booth logistics',
        bodyExcerpt: 'Confirming setup hours.',
        gmailUnread: true,
        userId: 'user-1',
        userEmail: 'rep@company.com',
        createdAt: new Date('2026-11-25T11:00:00Z'),
      },
      {
        _id: 'act_already_read_in_gmail',
        brand: 'cogmap',
        tenantId: 'default',
        threadId: '18f0000000000003',
        leadId: null,
        type: 'email-inbound',
        direction: 'inbound',
        fromAddress: 'older@contact.org',
        toAddresses: ['rep@company.com'],
        subject: 'Last month follow-up',
        bodyExcerpt: 'Already opened in Gmail.',
        gmailUnread: false,
        userId: 'user-1',
        userEmail: 'rep@company.com',
        createdAt: new Date('2026-11-10T09:00:00Z'),
      },
    ];
    const stateDocs: any[] = [];
    const leadDocs: any[] = [
      {
        _id: '507f1f77bcf86cd799439011',
        entity_name: 'Known Football Club',
        contactEmails: ['vp@knownclub.com'],
        contacts: [{ name: 'VP Commercial', email: 'vp@knownclub.com' }],
      },
    ];
    const staleSuccessIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const mockDb: any = {
      collection: (name: string) => {
        if (name === ACTIVITY_LOG_COLLECTION) {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: (q: any) => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () =>
                    activityDocs.filter((d) => (!q.brand || d.brand === q.brand)),
                }),
                toArray: async () =>
                  activityDocs.filter((d) => {
                    if (q.brand && d.brand !== q.brand) return false;
                    if (q.$or) {
                      return q.$or.some(
                        (c: any) => (c.threadId && d.threadId === c.threadId) || (c.externalId && d.externalId === c.externalId)
                      );
                    }
                    return true;
                  }),
              }),
            }),
            insertOne: async (doc: any) => {
              activityDocs.push({ ...doc, _id: `act_${activityDocs.length + 1}` });
              return { insertedId: `act_${activityDocs.length}` };
            },
          };
        }
        if (name === 'inbox_thread_states') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: () => ({ toArray: async () => stateDocs }),
            findOne: async (q: any) => stateDocs.find((s) => s.threadId === q.threadId && s.brand === q.brand) || null,
            updateOne: async (q: any, u: any, opts?: any) => {
              const idx = stateDocs.findIndex((s) => s.threadId === q.threadId && s.brand === q.brand);
              if (idx >= 0) Object.assign(stateDocs[idx], u.$set);
              else if (opts?.upsert) stateDocs.push({ ...q, ...u.$setOnInsert, ...u.$set });
              return { acknowledged: true };
            },
          };
        }
        if (name === 'leads') {
          return {
            find: () => ({
              sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
              toArray: async () => leadDocs,
            }),
            findOne: async () => leadDocs[0],
          };
        }
        if (name === 'integration_connections') {
          return {
            find: () => ({
              sort: () => ({
                toArray: async () => [
                  {
                    id: 'conn-1',
                    provider: 'gmail',
                    status: 'active',
                    userId: 'user-1',
                    userEmail: 'rep@company.com',
                    isDefault: true,
                  },
                ],
              }),
              toArray: async () => [
                {
                  id: 'conn-1',
                  provider: 'gmail',
                  status: 'active',
                  userId: 'user-1',
                  userEmail: 'rep@company.com',
                  isDefault: true,
                },
              ],
            }),
            findOne: async () => null,
          };
        }
        if (name === GMAIL_SYNC_CURSORS_COLLECTION) {
          return {
            findOne: async () => ({
              connectionId: 'conn-1',
              brand: 'cogmap',
              lastSyncedAt: staleSuccessIso,
              lastSuccessAt: staleSuccessIso,
              lastPolledAt: staleSuccessIso,
              lastError: null,
            }),
          };
        }
        return {
          createIndex: vi.fn().mockResolvedValue('ok'),
          find: () => ({
            sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
            toArray: async () => [],
          }),
          findOne: async () => null,
        };
      },
    };

    const inboxUnread = await listInboxThreads(mockDb, 'cogmap', 'default', {
      stream: 'inbox',
      unreadOnly: true,
      userId: 'user-1',
      userEmail: 'rep@company.com',
    });
    // Thread 3 was already read in Gmail (gmailUnread: false), so exactly 2 conversations are unread
    expect(inboxUnread.total).toBe(2);
    expect(inboxUnread.unreadInboxCount).toBe(2);

    const crmThread = inboxUnread.threads.find((t) => t.id === '18f0000000000001');
    const nonCrmThread = inboxUnread.threads.find((t) => t.id === '18f0000000000002');
    expect(crmThread?.hasLead).toBe(true);
    expect(crmThread?.isCrmLead).toBe(true);
    expect(crmThread?.leadName).toBe('Known Football Club');
    expect(nonCrmThread?.hasLead).toBe(false);
    expect(nonCrmThread?.isCrmLead).toBe(false);

    // Today dashboard summary matches Inbox drill-down count and flags stale sync (>2h)
    const todayBefore = await getTodayViewData(mockDb, 'cogmap' as any, {
      scope: 'mine',
      userId: 'user-1',
      userEmail: 'rep@company.com',
      tenantId: 'default',
    });
    expect(todayBefore.inboxSummary?.unreadConversations).toBe(2);
    expect(todayBefore.inboxSummary?.syncState).toBe('stale');
    expect(todayBefore.inboxSummary?.lastSuccessAt).toBe(staleSuccessIso);

    // Reading one conversation decrements both Inbox and Today unread counts to 1
    await setThreadStatus(mockDb, 'cogmap', 'default', '18f0000000000002', { isRead: true }, 'user-1');
    const todayAfter = await getTodayViewData(mockDb, 'cogmap' as any, {
      scope: 'mine',
      userId: 'user-1',
      userEmail: 'rep@company.com',
      tenantId: 'default',
    });
    expect(todayAfter.inboxSummary?.unreadConversations).toBe(1);

    // Disconnected health check
    const disconnectedHealth = await getGmailSyncHealth(
      {
        collection: () => ({
          find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
          findOne: async () => null,
        }),
      } as any,
      'cogmap',
      'default',
      { userId: 'user-none', userEmail: 'none@company.com' }
    );
    expect(disconnectedHealth.state).toBe('disconnected');
    expect(typeof postInboxReply).toBe('function');
  });
});
