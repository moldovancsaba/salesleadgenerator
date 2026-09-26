import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { ObjectId, type Db } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #205 — POST /api/outreach-send end to end (the new rep-initiated
// send path), plus regression coverage that POST /api/outreach-logs (the
// pre-existing record-only path, untouched by this issue) and the merged
// Activity timeline (GET /api/leads/[id]/activity) both still behave
// correctly once a real send can also write to activityLog.
//
// Issue #227 — both write routes are brand-gated (requireBrandAccessApi,
// not key-only), resolve ?brand= to a canonical slug, and outreach-send
// takes recipients from the stored lead rather than the request body.

process.env.RESEND_API_KEY = 're_test_placeholder_key';

let mongod: MongoMemoryServer;
let sendPOST: typeof import('../../app/api/outreach-send/route').POST;
let logsPOST: typeof import('../../app/api/outreach-logs/route').POST;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let activityGET: typeof import('../../app/api/leads/[id]/activity/route').GET;
let createApiKey: typeof import('../../app/lib/api-key-store').createApiKey;
let db: Db;

beforeAll(async () => {
  mongod = await startTestMongo();
  createApiKey = (await import('../../app/lib/api-key-store')).createApiKey;
  db = (await (await import('../../lib/mongodb')).getClientPromise()).db();
  sendPOST = (await import('../../app/api/outreach-send/route')).POST;
  logsPOST = (await import('../../app/api/outreach-logs/route')).POST;
  leadsPOST = (await import('../../app/api/leads/route')).POST;
  activityGET = (await import('../../app/api/leads/[id]/activity/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function req(url: string, init?: Record<string, any>) {
  return buildApiRequest(url, init as any);
}

// Same real-network-boundary mock as tests/integration/outreach-send.integration.test.ts.
// Returns the JSON bodies actually sent to the email API, so a test can
// assert on the real recipient.
function mockSendApi(response: { id: string } | { errorStatus: number; message?: string }) {
  const original = global.fetch;
  const sentBodies: any[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/emails')) {
      sentBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      if ('errorStatus' in response) {
        return new Response(JSON.stringify({ name: 'validation_error', message: response.message || 'rejected' }), {
          status: response.errorStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: response.id }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return original(input, init);
  });
  return sentBodies;
}

// A request with no credential at all — buildApiRequest always adds the
// legacy x-api-key, and requireBrandAccessApi then falls through to the
// (absent) SSO session cookie.
function unauthenticated(url: string, body: Record<string, any>) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seyuScopedKey(): Promise<string> {
  const { rawKey } = await createApiKey(db, { name: 'seyu-only', brand: 'seyu', scopes: ['read-write'] }, 'integration-test');
  return rawKey;
}

// Inserted directly (not via POST /api/leads) so a test can store a lead
// that POST /api/leads' own validation would reject, or in another brand's
// collection.
async function insertLead(collection: string, doc: Record<string, any>): Promise<string> {
  const _id = new ObjectId();
  await db.collection(collection).insertOne({ _id, tenantId: 'default', ...doc });
  return _id.toString();
}

async function createLead(entityName: string): Promise<{ id: string; contacts: any[] }> {
  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const contacts = [{ name: 'Jamie Rivera', email: `jamie@${slug}.example.com`, isDecisionMaker: true }];
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${slug}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts,
    }),
  }));
  expect(res.status).toBe(201);
  const body = await res.json();
  return { id: body.lead._id, contacts };
}

function sendPayload(leadId: string, contacts: any[], overrides: Record<string, any> = {}) {
  return {
    leadId,
    templateId: 'tpl-1',
    subject: 'Hello there',
    body: 'Hi Jamie, reaching out.',
    contacts,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

const SEND_URL = '/api/outreach-send?brand=cogmap';

describe('POST /api/outreach-send', () => {
  it('rejects a request with no credential (401)', async () => {
    const { id, contacts } = await createLead('Unauth Send Co');
    const res = await sendPOST(unauthenticated(SEND_URL, sendPayload(id, contacts)));
    expect(res.status).toBe(401);
  });

  it('400s on an unknown brand', async () => {
    const { id, contacts } = await createLead('Unknown Brand Send Co');
    const res = await sendPOST(req('/api/outreach-send?brand=not-a-brand', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid brand');
  });

  it('403s a scoped key issued for a different brand', async () => {
    const { id, contacts } = await createLead('Wrong Brand Key Send Co');
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': await seyuScopedKey() },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(res.status).toBe(403);
  });

  it('400s on a missing required field', async () => {
    const { id, contacts } = await createLead('Missing Field Co');
    const payload = sendPayload(id, contacts, { idempotencyKey: undefined });
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(400);
  });

  it('404s when the lead does not exist', async () => {
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(new ObjectId().toString(), [{ name: 'Jamie', email: 'jamie@x.example.com', isDecisionMaker: true }])),
    }));
    expect(res.status).toBe(404);
  });

  it("404s for a lead that exists only in another brand's collection", async () => {
    const contacts = [{ name: 'Sam', email: 'sam@seyu-only.example.com', isDecisionMaker: true }];
    const seyuLeadId = await insertLead('seyu_leads', { entity_name: 'Seyu Only Co', url: 'https://seyu-only.example.com', contacts });
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(seyuLeadId, contacts)),
    }));
    expect(res.status).toBe(404);
  });

  it("400s when the stored lead's decision-maker has no email, even if the body supplies one", async () => {
    const leadId = await insertLead('leads', {
      entity_name: 'No Email Co',
      url: 'https://no-email.example.com',
      contacts: [{ name: 'No Email', isDecisionMaker: true }],
    });
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(leadId, [{ name: 'Injected', email: 'injected@attacker.example.com', isDecisionMaker: true }])),
    }));
    expect(res.status).toBe(400);
  });

  it('sends to the stored lead\'s decision-maker, never to contacts supplied in the body', async () => {
    const sentBodies = mockSendApi({ id: 'route-send-stored-recipient' });
    const { id } = await createLead('Stored Recipient Co');
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, [{ name: 'Injected', email: 'injected@attacker.example.com', isDecisionMaker: true }], {
        url: 'https://attacker.example.com',
      })),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(true);
    expect(sentBodies).toHaveLength(1);
    const recipients = JSON.stringify(sentBodies[0].to);
    expect(recipients).toContain('jamie@stored-recipient-co.example.com');
    expect(recipients).not.toContain('attacker');
  });

  it('sends successfully and returns sent:true with an outreachLogId', async () => {
    mockSendApi({ id: 'route-send-id-1' });
    const { id, contacts } = await createLead('Route Send Co');
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(true);
    expect(body.outreachLogId).toBeTruthy();
  });

  it('a Resend-side rejection resolves to a handled 200 {sent:false}, not a 500', async () => {
    mockSendApi({ errorStatus: 422, message: 'recipient is on suppression list' });
    const { id, contacts } = await createLead('Route Reject Co');
    const res = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(false);
    expect(body.reason).toContain('resend rejected');
  });

  it('503s when Resend sending is not configured', async () => {
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const { id, contacts } = await createLead('No Resend Config Co');
      const res = await sendPOST(req(SEND_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendPayload(id, contacts)),
      }));
      expect(res.status).toBe(503);
    } finally {
      process.env.RESEND_API_KEY = original;
    }
  });
});

describe('POST /api/outreach-logs', () => {
  it('still logs a record-only outreach entry with no sendAttempted field (body brand fallback)', async () => {
    const { id, contacts } = await createLead('Log Only Co');
    const res = await logsPOST(req('/api/outreach-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sendAttempted).toBeUndefined();
    expect(body.brand).toBe('cogmap');
  });

  it('stores the canonical brand slug resolved from a ?brand= alias', async () => {
    const { id, contacts } = await createLead('Log Alias Co');
    const res = await logsPOST(req('/api/outreach-logs?brand=cogmapsales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));
    expect(res.status).toBe(201);
    const stored = await db.collection('outreach_logs').findOne({ _id: new ObjectId((await res.json()).id) });
    expect(stored?.brand).toBe('cogmap');
  });

  it('rejects a request with no credential (401)', async () => {
    const { id, contacts } = await createLead('Log Unauth Co');
    const res = await logsPOST(unauthenticated('/api/outreach-logs?brand=cogmap', {
      leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts,
    }));
    expect(res.status).toBe(401);
  });

  it('400s on an unknown brand', async () => {
    const { id, contacts } = await createLead('Log Unknown Brand Co');
    const res = await logsPOST(req('/api/outreach-logs?brand=not-a-brand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));
    expect(res.status).toBe(400);
  });

  it('403s a scoped key issued for a different brand', async () => {
    const { id, contacts } = await createLead('Log Wrong Brand Key Co');
    const res = await logsPOST(req('/api/outreach-logs?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': await seyuScopedKey() },
      body: JSON.stringify({ leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/leads/[id]/activity — a real manual send never renders twice (issue 205)', () => {
  it('a successful "Send email" appears exactly once in the merged timeline, as source:manual', async () => {
    mockSendApi({ id: 'timeline-dedup-id-1' });
    const { id, contacts } = await createLead('Timeline Dedup Co');

    const sendRes = await sendPOST(req(SEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(sendRes.status).toBe(200);

    const activityRes = await activityGET(req(`/api/leads/${id}/activity?brand=cogmap`), { params: Promise.resolve({ id }) });
    expect(activityRes.status).toBe(200);
    const activityBody = await activityRes.json();
    const matching = activityBody.activity.filter((entry: any) => entry.type === 'email-outbound');
    expect(matching).toHaveLength(1);
    expect(matching[0].source).toBe('manual');
  });

  it('a plain "Log outreach" record-only entry still renders (source: outreach-log)', async () => {
    const { id, contacts } = await createLead('Log Outreach Timeline Co');
    await logsPOST(req('/api/outreach-logs?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));

    const activityRes = await activityGET(req(`/api/leads/${id}/activity?brand=cogmap`), { params: Promise.resolve({ id }) });
    const activityBody = await activityRes.json();
    const matching = activityBody.activity.filter((entry: any) => entry.type === 'email-outbound');
    expect(matching).toHaveLength(1);
    expect(matching[0].source).toBe('outreach-log');
  });
});
