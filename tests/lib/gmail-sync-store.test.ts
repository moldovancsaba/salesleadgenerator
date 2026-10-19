import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

// Setup required encryption key before importing integration-store
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/callback';

import { pollSingleGmailConnection, pollGmailForBrand, pollUserGmail } from '../../app/lib/gmail-sync-store';
import { encryptCredentials } from '../../lib/integration-crypto';
import type { IntegrationConnection } from '../../lib/integration-connections';

describe('Gmail Sync Store (Issue 216 & 249)', () => {
  let mockDb: any;
  let activityLogs: any[];
  let cursors: any[];
  let leads: any[];
  let connections: any[];

  beforeEach(() => {
    activityLogs = [];
    cursors = [];
    leads = [];
    connections = [];

    mockDb = {
      collection: (name: string) => {
        if (name === 'gmailSyncCursors') {
          return {
            createIndex: vi.fn().mockResolvedValue('idx_cursors'),
            findOne: vi.fn().mockImplementation((q: any) => {
              return Promise.resolve(cursors.find((c) => c.connectionId === q.connectionId && c.brand === q.brand) || null);
            }),
            updateOne: vi.fn().mockImplementation((q: any, update: any) => {
              const existing = cursors.find((c) => c.connectionId === q.connectionId && c.brand === q.brand);
              if (existing) {
                Object.assign(existing, update.$set);
              } else {
                cursors.push({ ...q, ...update.$set });
              }
              return Promise.resolve({ acknowledged: true });
            }),
          };
        }
        if (name === 'activityLog') {
          return {
            createIndex: vi.fn().mockResolvedValue('idx_activity'),
            findOne: vi.fn().mockImplementation((q: any) => {
              if (q.externalId) {
                return Promise.resolve(activityLogs.find((a) => a.externalId === q.externalId) || null);
              }
              if (q.fallbackHash) {
                return Promise.resolve(activityLogs.find((a) => a.fallbackHash === q.fallbackHash) || null);
              }
              return Promise.resolve(null);
            }),
            insertOne: vi.fn().mockImplementation((doc: any) => {
              activityLogs.push(doc);
              return Promise.resolve({ insertedId: `act-${activityLogs.length}` });
            }),
          };
        }
        if (name === 'integration_connections') {
          return {
            find: vi.fn().mockImplementation((q: any) => ({
              toArray: vi.fn().mockResolvedValue(
                connections.filter((c) => {
                  if (q.provider && c.provider !== q.provider) return false;
                  if (q.status && c.status !== q.status) return false;
                  if (q.brand && c.brand !== q.brand) return false;
                  return true;
                })
              ),
            })),
            findOne: vi.fn().mockImplementation((q: any) => {
              return Promise.resolve(
                connections.find((c) => {
                  if (q.brand && c.brand !== q.brand) return false;
                  if (q.provider && c.provider !== q.provider) return false;
                  if (q.userId && c.userId !== q.userId) return false;
                  return true;
                }) || null
              );
            }),
          };
        }
        if (name === 'leads' || name === 'leads_cogmap') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: vi.fn().mockImplementation((q: any) => ({
              limit: vi.fn().mockReturnThis(),
              sort: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockImplementation(() => {
                if (q?.contactEmails) {
                  return Promise.resolve(
                    leads
                      .filter((l) => (l.contactEmails || []).includes(q.contactEmails))
                      .map((l) => ({ _id: l._id }))
                  );
                }
                return Promise.resolve(leads.map((l) => ({ contactEmails: l.contactEmails })));
              }),
            })),
            findOne: vi.fn().mockImplementation((q: any) => {
              return Promise.resolve(leads.find((l) => l._id.toString() === q._id?.toString()) || null);
            }),
            updateOne: vi.fn().mockImplementation((q: any, update: any) => {
              const lead = leads.find((l) => l._id.toString() === q._id?.toString());
              if (lead && update.$set) {
                Object.assign(lead, update.$set);
              }
              return Promise.resolve({ modifiedCount: 1 });
            }),
          };
        }
        return {
          createIndex: vi.fn().mockResolvedValue('ok'),
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnThis(),
            sort: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        };
      },
    };
  });

  const sampleConnection: IntegrationConnection = {
    id: 'conn-user-1',
    brand: 'cogmap',
    tenantId: 'default',
    provider: 'gmail',
    authMethod: 'oauth2',
    encryptedCredentials: encryptCredentials({ accessToken: 'valid-token', refreshToken: 'refresh-token' }),
    userId: 'user-sso-1',
    userEmail: 'rep.jane@example.com',
    status: 'active',
    connectedBy: 'user-sso-1',
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  const sampleBrandConfig = {
    brand: 'cogmap',
    dbCollection: 'leads_cogmap',
    label: 'CogMap',
    leadModel: 'b2b',
    fromEmail: 'sales@cogmap.com',
    allowedSsoDomains: ['example.com'],
  };

  it('ingests an email to/from a known contact and minimizes unneeded data', async () => {
    const knownEmails = new Set(['lead.decision@prospect.com']);

    // Mock Google APIs
    const originalFetch = global.fetch;
    const fetchCalls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      if (url.includes('/messages?')) {
        return new Response(JSON.stringify({ messages: [{ id: 'msg-101' }, { id: 'msg-102' }] }), { status: 200 });
      }
      if (url.includes('/messages/msg-101?format=metadata')) {
        return new Response(
          JSON.stringify({
            id: 'msg-101',
            threadId: 'th-101',
            payload: {
              headers: [
                { name: 'From', value: 'lead.decision@prospect.com' },
                { name: 'To', value: 'rep.jane@example.com' },
                { name: 'Subject', value: 'Interested in demo' },
                { name: 'Date', value: '2026-10-14T09:00:00Z' },
                { name: 'Message-ID', value: '<msg-101@prospect.com>' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/messages/msg-101?format=full')) {
        return new Response(
          JSON.stringify({
            id: 'msg-101',
            payload: {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Sounds great, let us connect next Tuesday.').toString('base64') },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/messages/msg-102?format=metadata')) {
        // Unrelated personal email
        return new Response(
          JSON.stringify({
            id: 'msg-102',
            payload: {
              headers: [
                { name: 'From', value: 'newsletter@random.org' },
                { name: 'To', value: 'rep.jane@example.com' },
                { name: 'Subject', value: 'Weekly digest' },
                { name: 'Date', value: '2026-10-14T09:05:00Z' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      const result = await pollSingleGmailConnection(
        mockDb,
        sampleConnection,
        'cogmap' as any,
        'default',
        sampleBrandConfig as any,
        knownEmails
      );

      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(1);

      // Verify data minimization: msg-102 format=full was NEVER fetched!
      const fullBodyCalls = fetchCalls.filter((u) => u.includes('format=full'));
      expect(fullBodyCalls.length).toBe(1);
      expect(fullBodyCalls[0]).toContain('msg-101');

      // Verify activityLog was written
      expect(activityLogs.length).toBe(1);
      expect(activityLogs[0].externalId).toBe('gmail:<msg-101@prospect.com>');
      expect(activityLogs[0].threadId).toBe('th-101');
      expect(activityLogs[0].rfcMessageId).toBe('<msg-101@prospect.com>');
      expect(activityLogs[0].direction).toBe('inbound');
      expect(activityLogs[0].subject).toBe('Interested in demo');
      expect(activityLogs[0].bodyExcerpt).toContain('Sounds great');

      // Verify cursor was updated
      expect(cursors.length).toBe(1);
      expect(cursors[0].connectionId).toBe('conn-user-1');
      expect(cursors[0].gmailAddress).toBe('rep.jane@example.com');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('stops active cadence sequence when an inbound prospect reply is received', async () => {
    const { ObjectId } = await import('mongodb');
    const leadId = new ObjectId();
    leads.push({
      _id: leadId,
      contactEmails: ['prospect.ceo@target.com'],
      contacts: [{ name: 'Prospect CEO', email: 'prospect.ceo@target.com', isDecisionMaker: true }],
      activeCadence: {
        cadenceId: 'cadence-123',
        currentStepIndex: 1,
        status: 'active',
        stepDueAt: new Date().toISOString(),
        taskStepId: 'calendar-task-step-99',
      },
    });

    const knownEmails = new Set(['prospect.ceo@target.com']);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/messages?')) {
        return new Response(JSON.stringify({ messages: [{ id: 'msg-reply-1' }] }), { status: 200 });
      }
      if (url.includes('/messages/msg-reply-1?format=metadata')) {
        return new Response(
          JSON.stringify({
            id: 'msg-reply-1',
            payload: {
              headers: [
                { name: 'From', value: 'prospect.ceo@target.com' },
                { name: 'To', value: 'rep.jane@example.com' },
                { name: 'Subject', value: 'Re: Partnerships' },
                { name: 'Date', value: '2026-10-14T09:30:00Z' },
                { name: 'Message-ID', value: '<reply-1@target.com>' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/messages/msg-reply-1?format=full')) {
        return new Response(
          JSON.stringify({
            id: 'msg-reply-1',
            payload: {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Please send me pricing details.').toString('base64') },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      const result = await pollSingleGmailConnection(
        mockDb,
        sampleConnection,
        'cogmap' as any,
        'default',
        sampleBrandConfig as any,
        knownEmails
      );

      expect(result.ingested).toBe(1);

      // Verify the lead's activeCadence was automatically cancelled
      const targetLead = leads.find((l) => l._id.toString() === leadId.toString());
      expect(targetLead.activeCadence).toBeNull();
      expect(targetLead.nextActionDueAt).toBeNull();
      expect(targetLead.nextActionNote).toBe('Sequence stopped: contact replied via Gmail');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('pollGmailForBrand polls both brand connection and user connections', async () => {
    connections.push({
      id: 'conn-brand-1',
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      authMethod: 'oauth2',
      encryptedCredentials: encryptCredentials({ accessToken: 'brand-token' }),
      status: 'active',
      userEmail: 'team@cogmap.com',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    connections.push(sampleConnection);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/messages?')) {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      const result = await pollGmailForBrand(mockDb, 'cogmap' as any, 'default');
      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failure).toBeUndefined();

      // Cursors should be created for BOTH connections
      expect(cursors.length).toBe(2);
      expect(cursors.some((c) => c.connectionId === 'conn-brand-1')).toBe(true);
      expect(cursors.some((c) => c.connectionId === 'conn-user-1')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('pollUserGmail returns failure when user has no active connection', async () => {
    const result = await pollUserGmail(mockDb, 'non-existent-user', 'cogmap');
    expect(result.ingested).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failure).toBe('no_active_connection');
  });

  it('pollUserGmail polls the specific user Gmail connection across brand leads', async () => {
    connections.push(sampleConnection);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/messages?')) {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      const result = await pollUserGmail(mockDb, 'user-sso-1', 'cogmap');
      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failure).toBeUndefined();

      expect(cursors.some((c) => c.connectionId === 'conn-user-1')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
