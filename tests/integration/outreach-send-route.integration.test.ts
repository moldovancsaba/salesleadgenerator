import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #205 — POST /api/outreach-send end to end (the new rep-initiated
// send path), plus regression coverage that POST /api/outreach-logs (the
// pre-existing record-only path, untouched by this issue) and the merged
// Activity timeline (GET /api/leads/[id]/activity) both still behave
// correctly once a real send can also write to activityLog.

process.env.RESEND_API_KEY = 're_test_placeholder_key';

let mongod: MongoMemoryServer;
let sendPOST: typeof import('../../app/api/outreach-send/route').POST;
let logsPOST: typeof import('../../app/api/outreach-logs/route').POST;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let activityGET: typeof import('../../app/api/leads/[id]/activity/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
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
function mockSendApi(response: { id: string } | { errorStatus: number; message?: string }) {
  const original = global.fetch;
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/emails')) {
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
    brand: 'cogmap',
    leadId,
    templateId: 'tpl-1',
    subject: 'Hello there',
    body: 'Hi Jamie, reaching out.',
    contacts,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe('POST /api/outreach-send', () => {
  it('rejects an unauthenticated request', async () => {
    const { id, contacts } = await createLead('Unauth Send Co');
    const res = await sendPOST(new Request('http://localhost/api/outreach-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(id, contacts)),
    }));
    expect(res.status).toBe(401);
  });

  it('400s on a missing required field', async () => {
    const { id, contacts } = await createLead('Missing Field Co');
    const payload = sendPayload(id, contacts, { idempotencyKey: undefined });
    const res = await sendPOST(req('/api/outreach-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(400);
  });

  it('400s when routing disallows (no decision-maker email)', async () => {
    const res = await sendPOST(req('/api/outreach-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload('lead-x', [{ name: 'No Email', isDecisionMaker: true }])),
    }));
    expect(res.status).toBe(400);
  });

  it('sends successfully and returns sent:true with an outreachLogId', async () => {
    mockSendApi({ id: 'route-send-id-1' });
    const { id, contacts } = await createLead('Route Send Co');
    const res = await sendPOST(req('/api/outreach-send', {
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
    const res = await sendPOST(req('/api/outreach-send', {
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
      const res = await sendPOST(req('/api/outreach-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendPayload(id, contacts)),
      }));
      expect(res.status).toBe(503);
    } finally {
      process.env.RESEND_API_KEY = original;
    }
  });
});

describe('POST /api/outreach-logs — unaffected by issue 205 (regression)', () => {
  it('still logs a record-only outreach entry with no sendAttempted field', async () => {
    const { id, contacts } = await createLead('Log Only Co');
    const res = await logsPOST(req('/api/outreach-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sendAttempted).toBeUndefined();
  });
});

describe('GET /api/leads/[id]/activity — a real manual send never renders twice (issue 205)', () => {
  it('a successful "Send email" appears exactly once in the merged timeline, as source:manual', async () => {
    mockSendApi({ id: 'timeline-dedup-id-1' });
    const { id, contacts } = await createLead('Timeline Dedup Co');

    const sendRes = await sendPOST(req('/api/outreach-send', {
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
    await logsPOST(req('/api/outreach-logs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', leadId: id, channel: 'email', subject: 'Hi', body: 'Hi there', contacts }),
    }));

    const activityRes = await activityGET(req(`/api/leads/${id}/activity?brand=cogmap`), { params: Promise.resolve({ id }) });
    const activityBody = await activityRes.json();
    const matching = activityBody.activity.filter((entry: any) => entry.type === 'email-outbound');
    expect(matching).toHaveLength(1);
    expect(matching[0].source).toBe('outreach-log');
  });
});
