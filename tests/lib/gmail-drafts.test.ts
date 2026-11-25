import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://sales.haho.ai/api/integrations/oauth/callback';

import { encryptCredentials } from '../../lib/integration-crypto';
import {
  listUserGmailDrafts,
  sendUserGmailDraft,
  GMAIL_DRAFT_DISPATCHES_COLLECTION,
} from '../../lib/gmail-drafts';
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

describe('Gmail Drafts integration for Inbox follow-ups (issue 358)', () => {
  const originalFetch = global.fetch;
  let dispatchedRows: any[];
  let activityRows: any[];
  let outreachRows: any[];
  let connections: any[];
  let leads: any[];
  let mockDb: any;

  beforeEach(() => {
    global.fetch = originalFetch;
    dispatchedRows = [];
    activityRows = [
      {
        _id: 'act_prior_thread',
        brand: 'cogmap',
        tenantId: 'default',
        threadId: '18f123456789abcd',
        leadId: '507f1f77bcf86cd799439022',
      },
    ];
    outreachRows = [];
    leads = [
      {
        _id: '507f1f77bcf86cd799439022',
        entity_name: 'Premier Arena Club',
        contactEmails: ['commercial@premierarena.co.uk'],
        contacts: [
          {
            name: 'Hannah Cole',
            email: 'commercial@premierarena.co.uk',
            isDecisionMaker: true,
          },
        ],
      },
    ];
    connections = [
      {
        id: 'conn-rep-1',
        brand: 'cogmap',
        tenantId: 'default',
        provider: 'gmail',
        authMethod: 'oauth2',
        status: 'active',
        userId: 'user-rep-1',
        userEmail: 'rep@company.com',
        isDefault: true,
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.compose',
        ],
        signatureText: 'Rep Name — Commercial Team',
        encryptedCredentials: encryptCredentials({
          accessToken: 'gmail-access-token',
          refreshToken: 'gmail-refresh-token',
        }),
        accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    ];

    mockDb = {
      collection: (name: string) => {
        if (name === 'integration_connections') {
          return {
            find: () => ({
              sort: () => ({ toArray: async () => connections }),
              toArray: async () => connections,
            }),
            findOne: async (q: any) =>
              connections.find((c) => (!q.id || c.id === q.id) && c.status !== 'revoked') || null,
          };
        }
        if (name === GMAIL_DRAFT_DISPATCHES_COLLECTION) {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: () => ({ toArray: async () => dispatchedRows }),
            findOne: async (q: any) =>
              dispatchedRows.find((d) => d.connectionId === q.connectionId && d.draftId === q.draftId) || null,
            updateOne: async (q: any, u: any) => {
              const existing = dispatchedRows.find(
                (d) => d.connectionId === q.connectionId && d.draftId === q.draftId
              );
              if (existing) Object.assign(existing, u.$set);
              else dispatchedRows.push({ ...q, ...u.$set });
              return { acknowledged: true };
            },
          };
        }
        if (name === 'leads') {
          return {
            find: () => ({ toArray: async () => leads }),
            findOne: async () => leads[0] || null,
          };
        }
        if (name === ACTIVITY_LOG_COLLECTION) {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: () => ({ toArray: async () => activityRows }),
            insertOne: async (doc: any) => {
              activityRows.push({ ...doc, _id: `act_${activityRows.length + 1}` });
              return { insertedId: `act_${activityRows.length}` };
            },
          };
        }
        if (name === 'outreach_logs') {
          return {
            insertOne: async (doc: any) => {
              outreachRows.push({ ...doc, _id: `out_${outreachRows.length + 1}` });
              return { insertedId: `out_${outreachRows.length}` };
            },
          };
        }
        return {
          find: () => ({ toArray: async () => [] }),
          findOne: async () => null,
        };
      },
    };
  });

  it('lists Gmail drafts and matches sender, recipient, CRM lead, and Inbox thread', async () => {
    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/drafts?maxResults=25')) {
        return new Response(JSON.stringify({ drafts: [{ id: 'r_draft_fyxer_1' }] }), { status: 200 });
      }
      if (url.includes('/drafts/r_draft_fyxer_1?format=full')) {
        return new Response(
          JSON.stringify({
            id: 'r_draft_fyxer_1',
            message: {
              id: 'msg_draft_1',
              threadId: '18f123456789abcd',
              internalDate: String(Date.parse('2026-11-25T14:00:00Z')),
              payload: {
                headers: [
                  { name: 'From', value: 'Rep Name <rep@company.com>' },
                  { name: 'To', value: 'Hannah Cole <commercial@premierarena.co.uk>' },
                  { name: 'Subject', value: 'Re: Follow-up from our Tuesday call' },
                  { name: 'In-Reply-To', value: '<prev-msg@premierarena.co.uk>' },
                  { name: 'References', value: '<prev-msg@premierarena.co.uk>' },
                ],
                mimeType: 'text/plain',
                body: {
                  data: Buffer.from(
                    'Hi Hannah,\n\nThanks for taking the time today — here are the agreed next steps.'
                  ).toString('base64'),
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const res = await listUserGmailDrafts(mockDb, 'cogmap', 'default', {
      userId: 'user-rep-1',
      userEmail: 'rep@company.com',
    });

    expect(res.connected).toBe(true);
    expect(res.drafts).toHaveLength(1);
    const draft = res.drafts[0];
    expect(draft.draftId).toBe('r_draft_fyxer_1');
    expect(draft.senderEmail).toBe('rep@company.com');
    expect(draft.to).toEqual(['commercial@premierarena.co.uk']);
    expect(draft.isCrmLead).toBe(true);
    expect(draft.matchedLeadId).toBe('507f1f77bcf86cd799439022');
    expect(draft.matchedLeadName).toBe('Premier Arena Club');
    expect(draft.matchedContactName).toBe('Hannah Cole');
    expect(draft.matchedThreadId).toBe('18f123456789abcd');
    expect(draft.bodyText).toContain('agreed next steps');
  });

  it('edits and sends a Gmail draft once via Google, records activityLog + outreach_logs, and hides sent draft on reload', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method || 'GET';
      calls.push({ method, url });

      if (method === 'PUT' && url.includes('/drafts/r_draft_fyxer_1')) {
        return new Response(JSON.stringify({ id: 'r_draft_fyxer_1' }), { status: 200 });
      }
      if (method === 'POST' && url.endsWith('/drafts/send')) {
        return new Response(
          JSON.stringify({ id: 'sent_gmail_msg_77', threadId: '18f123456789abcd' }),
          { status: 200 }
        );
      }
      if (url.endsWith('/drafts?maxResults=25')) {
        return new Response(JSON.stringify({ drafts: [{ id: 'r_draft_fyxer_1' }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const sendRes = await sendUserGmailDraft(
      mockDb,
      'cogmap',
      'default',
      {
        draftId: 'r_draft_fyxer_1',
        connectionId: 'conn-rep-1',
        to: 'commercial@premierarena.co.uk',
        subject: 'Re: Follow-up from our Tuesday call',
        body: 'Hi Hannah,\n\nEdited follow-up with pricing deck attached.',
        unchanged: false,
        includeSignature: true,
        threadId: '18f123456789abcd',
        inReplyTo: '<prev-msg@premierarena.co.uk>',
        references: '<prev-msg@premierarena.co.uk>',
        matchedLeadId: '507f1f77bcf86cd799439022',
      },
      { userId: 'user-rep-1', userEmail: 'rep@company.com', userName: 'Rep Name' }
    );

    expect(sendRes.ok).toBe(true);
    expect(sendRes.sentMessageId).toBe('sent_gmail_msg_77');
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/drafts/r_draft_fyxer_1'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/drafts/send'))).toBe(true);

    // Recorded once in activityLog and once in outreach_logs (with activityLogWritten: true)
    const outboundLogs = activityRows.filter((r) => r.type === 'email-outbound');
    expect(outboundLogs).toHaveLength(1);
    expect(outboundLogs[0].bodyExcerpt).toContain('Rep Name — Commercial Team');
    expect(outreachRows).toHaveLength(1);
    expect(outreachRows[0].activityLogWritten).toBe(true);

    // Duplicate retry is idempotent — does NOT call Gmail API or insert a second log
    const retryCountBefore = calls.length;
    const retryRes = await sendUserGmailDraft(
      mockDb,
      'cogmap',
      'default',
      {
        draftId: 'r_draft_fyxer_1',
        connectionId: 'conn-rep-1',
        to: 'commercial@premierarena.co.uk',
        subject: 'Re: Follow-up from our Tuesday call',
        body: 'Hi Hannah,\n\nEdited follow-up with pricing deck attached.',
      },
      { userId: 'user-rep-1', userEmail: 'rep@company.com' }
    );
    expect(retryRes.ok).toBe(true);
    expect(calls.length).toBe(retryCountBefore);
    expect(activityRows.filter((r) => r.type === 'email-outbound')).toHaveLength(1);

    // Subsequent listUserGmailDrafts excludes the already-sent draft
    const reload = await listUserGmailDrafts(mockDb, 'cogmap', 'default', {
      userId: 'user-rep-1',
      userEmail: 'rep@company.com',
    });
    expect(reload.drafts).toHaveLength(0);
  });
});
