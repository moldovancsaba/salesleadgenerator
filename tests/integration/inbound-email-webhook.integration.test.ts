import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { Webhook } from 'standardwebhooks';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

const TEST_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

process.env.RESEND_API_KEY = 're_test_placeholder_key';
process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;

let mongod: MongoMemoryServer;
let inboundPOST: typeof import('../../app/api/webhooks/inbound-email/route').POST;
let leadsPOST: typeof import('../../app/api/leads/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/webhooks/inbound-email/route');
  inboundPOST = mod.POST;
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function signedRequest(body: any, secret = TEST_SECRET) {
  const payload = JSON.stringify(body);
  const wh = new Webhook(secret);
  const timestamp = new Date();
  const msgId = `msg_${Math.random().toString(36).slice(2)}`;
  const signature = wh.sign(msgId, timestamp, payload);
  return { payload, headers: { 'svix-id': msgId, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': signature, 'Content-Type': 'application/json' } };
}

async function buildRequest(body: any, opts?: { secret?: string; headers?: Record<string, string> }) {
  const { NextRequest } = await import('next/server');
  const { payload, headers } = signedRequest(body, opts?.secret);
  return new NextRequest('http://localhost/api/webhooks/inbound-email', {
    method: 'POST',
    body: payload,
    headers: { ...headers, ...(opts?.headers || {}) },
  });
}

// Mocks the follow-up "fetch full email content" call
// (resend.emails.receiving.get -> GET https://api.resend.com/emails/receiving/{id})
// at the fetch layer, matching how the real resend SDK makes that request
// internally (verified against node_modules/resend/dist/index.mjs's
// fetchRequest()), rather than mocking the SDK's own class — this is the
// SDK's real network boundary, not a reimplementation of its internals.
function mockReceivingApi(response: Partial<{ text: string; html: string }> | { errorStatus: number }) {
  const original = global.fetch;
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/emails/receiving/')) {
      if ('errorStatus' in response) {
        return new Response(JSON.stringify({ message: 'not found' }), { status: response.errorStatus });
      }
      return new Response(JSON.stringify({
        object: 'email', id: 'email-mock-id', to: [], from: '', created_at: new Date().toISOString(),
        subject: '', bcc: [], cc: [], reply_to: [], received_for: [], message_id: '', attachments: [],
        text: response.text ?? null, html: response.html ?? null, headers: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input, init);
  });
}

async function insertedActivityLogDocs(): Promise<any[]> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const docs = await client.db().collection('activityLog').find({}).toArray();
  await client.close();
  return docs;
}

async function insertedContactSuggestionDocs(): Promise<any[]> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const docs = await client.db().collection('contactSuggestions').find({}).toArray();
  await client.close();
  return docs;
}

async function createLead(brand: 'cogmap' | 'seyu', entityName: string, contacts: any[]): Promise<string> {
  const res = await leadsPOST(buildApiRequest(`/api/leads?brand=${brand}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts,
    }),
  }));
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.lead._id;
}

describe('POST /api/webhooks/inbound-email', () => {
  it('verifies, fetches the full body, and stores a correctly-classified inbound activityLog entry', async () => {
    mockReceivingApi({ text: 'Thanks for reaching out, interested!' });
    const req = await buildRequest({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'email-1', from: 'lead-contact@example.com', to: ['cogmap@abc123.resend.app'],
        bcc: [], cc: [], received_for: ['cogmap@abc123.resend.app'], message_id: '<1@example.com>',
        subject: 'Re: intro', attachments: [],
      },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const docs = await insertedActivityLogDocs();
    const doc = docs.find((d) => d.externalId === 'email-1');
    expect(doc).toBeDefined();
    expect(doc.brand).toBe('cogmap');
    expect(doc.type).toBe('email-inbound');
    expect(doc.direction).toBe('inbound');
    expect(doc.leadId).toBeNull();
    expect(doc.bodyExcerpt).toBe('Thanks for reaching out, interested!');
  });

  it('classifies a bcc-capture shaped event (our address only via received_for) as outbound', async () => {
    mockReceivingApi({ text: 'Hi, following up on our conversation.' });
    const req = await buildRequest({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'email-2', from: 'rep@ourcompany.com', to: ['lead-contact@example.com'],
        bcc: [], cc: [], received_for: ['seyu@abc123.resend.app'], message_id: '<2@example.com>',
        subject: 'Quick intro', attachments: [],
      },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(200);
    const docs = await insertedActivityLogDocs();
    const doc = docs.find((d) => d.externalId === 'email-2');
    expect(doc.brand).toBe('seyu');
    expect(doc.type).toBe('email-outbound');
    expect(doc.direction).toBe('outbound');
  });

  it('stores an event with an unresolvable brand rather than dropping it', async () => {
    mockReceivingApi({ text: 'body' });
    const req = await buildRequest({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'email-3', from: 'a@b.com', to: ['unknown@abc123.resend.app'],
        bcc: [], cc: [], received_for: ['unknown@abc123.resend.app'], message_id: '<3@example.com>',
        subject: 'x', attachments: [],
      },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(200);
    const docs = await insertedActivityLogDocs();
    expect(docs.find((d) => d.externalId === 'email-3').brand).toBe('unresolved');
  });

  it('rejects a request with an invalid signature and stores nothing', async () => {
    mockReceivingApi({ text: 'should not be reached' });
    const req = await buildRequest({
      type: 'email.received', created_at: new Date().toISOString(),
      data: { email_id: 'email-invalid-sig', from: 'a@b.com', to: ['cogmap@abc.resend.app'], bcc: [], cc: [], received_for: [], message_id: '', subject: '', attachments: [] },
    }, { secret: 'whsec_totallyWrongSecretUsedToSignThisOne' });
    const res = await inboundPOST(req);
    expect(res.status).toBe(400);
    const docs = await insertedActivityLogDocs();
    expect(docs.find((d) => d.externalId === 'email-invalid-sig')).toBeUndefined();
  });

  it('rejects a request missing the signature headers entirely', async () => {
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/webhooks/inbound-email', {
      method: 'POST',
      body: JSON.stringify({ type: 'email.received', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(400);
  });

  it('is idempotent under a webhook retry with the same email_id (duplicate, not a second entry)', async () => {
    mockReceivingApi({ text: 'retry body' });
    const eventBody = {
      type: 'email.received', created_at: new Date().toISOString(),
      data: {
        email_id: 'email-retry-1', from: 'lead@example.com', to: ['cogmap@abc.resend.app'],
        bcc: [], cc: [], received_for: ['cogmap@abc.resend.app'], message_id: '<retry@example.com>',
        subject: 'retry test', attachments: [],
      },
    };
    const firstReq = await buildRequest(eventBody);
    const firstRes = await inboundPOST(firstReq);
    expect(firstRes.status).toBe(200);
    expect((await firstRes.json()).duplicate).toBeUndefined();

    const secondReq = await buildRequest(eventBody);
    const secondRes = await inboundPOST(secondReq);
    expect(secondRes.status).toBe(200);
    expect((await secondRes.json()).duplicate).toBe(true);

    const docs = await insertedActivityLogDocs();
    expect(docs.filter((d) => d.externalId === 'email-retry-1')).toHaveLength(1);
  });

  it('ignores a non-email.received event type without erroring', async () => {
    const req = await buildRequest({ type: 'email.sent', created_at: new Date().toISOString(), data: {} });
    const res = await inboundPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBe(true);
  });

  it('still records the event when the full-body fetch fails, rather than dropping it', async () => {
    mockReceivingApi({ errorStatus: 500 });
    const req = await buildRequest({
      type: 'email.received', created_at: new Date().toISOString(),
      data: {
        email_id: 'email-fetch-fail', from: 'lead@example.com', to: ['cogmap@abc.resend.app'],
        bcc: [], cc: [], received_for: ['cogmap@abc.resend.app'], message_id: '<4@example.com>',
        subject: 'fetch-fail test', attachments: [],
      },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(200);
    const docs = await insertedActivityLogDocs();
    const doc = docs.find((d) => d.externalId === 'email-fetch-fail');
    expect(doc).toBeDefined();
    // The Mongo driver serializes a JS `undefined` field value to BSON null
    // on insert by default (ignoreUndefined is off) — mapActivityLogDoc's
    // truncateBody() already treats null the same as undefined for display.
    expect(doc.bodyExcerpt).toBeNull();
  });

  it('returns 503 when Resend is not configured', async () => {
    const savedKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const { NextRequest } = await import('next/server');
      const req = new NextRequest('http://localhost/api/webhooks/inbound-email', { method: 'POST', body: '{}' });
      const res = await inboundPOST(req);
      expect(res.status).toBe(503);
    } finally {
      process.env.RESEND_API_KEY = savedKey;
    }
  });

  // Issue #142 — end-to-end from a simulated inbound-reply payload through to
  // a stored contact-enrichment suggestion, per the issue's own acceptance
  // criteria. Builds on the matching/suggestion unit coverage in
  // tests/integration/contact-reply-matching.integration.test.ts by proving
  // the full webhook wiring (route -> matching -> suggestion) end-to-end.
  describe('reply matching + contact-enrichment suggestions (issue #142)', () => {
    it('matches a reply to its lead, sets leadId/matchedContactKey, and stores a pending suggestion', async () => {
      const leadId = await createLead('cogmap', 'Reply Match FC', [
        { name: 'Pat Morgan', email: 'pat.morgan@example.com', title: 'Manager' },
      ]);
      mockReceivingApi({
        text: ['Sounds great, let us proceed.', '', 'Best,', 'Pat Morgan', 'Director of Sponsorships', '+1 555 222 3333'].join('\n'),
      });
      const req = await buildRequest({
        type: 'email.received',
        created_at: new Date().toISOString(),
        data: {
          email_id: 'email-match-1', from: 'pat.morgan@example.com', to: ['cogmap@abc123.resend.app'],
          bcc: [], cc: [], received_for: ['cogmap@abc123.resend.app'], message_id: '<match1@example.com>',
          subject: 'Re: intro', attachments: [],
        },
      });
      const res = await inboundPOST(req);
      expect(res.status).toBe(200);

      const docs = await insertedActivityLogDocs();
      const doc = docs.find((d) => d.externalId === 'email-match-1');
      expect(doc.leadId).toBe(leadId);
      expect(doc.matchedContactKey).toBeTruthy();
      expect(doc.matchedLeadIds).toBeUndefined();

      const suggestions = await insertedContactSuggestionDocs();
      const suggestion = suggestions.find((s) => s.leadId === leadId);
      expect(suggestion).toBeDefined();
      expect(suggestion.status).toBe('pending');
      expect(suggestion.suggested.title).toBe('Director of Sponsorships');
      expect(suggestion.sourceActivityLogId).toBe(String(doc._id));
    });

    it('flags matchedLeadIds and generates no suggestion when the sender email matches more than one lead', async () => {
      await createLead('cogmap', 'Multi Match Reply A', [{ name: 'Shared Rep', email: 'shared.rep@example.com' }]);
      await createLead('cogmap', 'Multi Match Reply B', [{ name: 'Shared Rep', email: 'shared.rep@example.com' }]);
      mockReceivingApi({ text: 'Following up on this.' });
      const req = await buildRequest({
        type: 'email.received',
        created_at: new Date().toISOString(),
        data: {
          email_id: 'email-multi-1', from: 'shared.rep@example.com', to: ['cogmap@abc123.resend.app'],
          bcc: [], cc: [], received_for: ['cogmap@abc123.resend.app'], message_id: '<multi1@example.com>',
          subject: 'Re: intro', attachments: [],
        },
      });
      const res = await inboundPOST(req);
      expect(res.status).toBe(200);

      const docs = await insertedActivityLogDocs();
      const doc = docs.find((d) => d.externalId === 'email-multi-1');
      expect(doc.leadId).toBeNull();
      expect(doc.matchedLeadIds).toHaveLength(2);

      const suggestions = await insertedContactSuggestionDocs();
      expect(suggestions.find((s) => s.sourceActivityLogId === String(doc._id))).toBeUndefined();
    });

    it('logs the reply with no leadId and generates no suggestion when the sender matches no lead', async () => {
      mockReceivingApi({ text: 'Regards,\nUnknown Sender\nCEO\n+1 555 000 1111' });
      const req = await buildRequest({
        type: 'email.received',
        created_at: new Date().toISOString(),
        data: {
          email_id: 'email-nomatch-1', from: 'no-such-contact@example.com', to: ['cogmap@abc123.resend.app'],
          bcc: [], cc: [], received_for: ['cogmap@abc123.resend.app'], message_id: '<nomatch1@example.com>',
          subject: 'Re: intro', attachments: [],
        },
      });
      const res = await inboundPOST(req);
      expect(res.status).toBe(200);

      const docs = await insertedActivityLogDocs();
      const doc = docs.find((d) => d.externalId === 'email-nomatch-1');
      expect(doc.leadId).toBeNull();
      expect(doc.matchedLeadIds).toBeUndefined();

      const suggestions = await insertedContactSuggestionDocs();
      expect(suggestions.find((s) => s.sourceActivityLogId === String(doc._id))).toBeUndefined();
    });
  });
});
