import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { verifyWebhookSignature } from '../../lib/webhooks';

// Outbound webhooks (issue #210 sub-issue #219). The admin CRUD routes are
// requireSuperAdminSession-gated — mocked identically to
// tests/integration/api-keys.integration.test.ts, for the same documented
// reason (no real signed SSO JWT available in this sandbox).
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const requireSuperAdminSessionMock = vi.fn();
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let webhooksGET: typeof import('../../app/api/admin/webhooks/route').GET;
let webhooksPOST: typeof import('../../app/api/admin/webhooks/route').POST;
let webhookDELETE: typeof import('../../app/api/admin/webhooks/[id]/route').DELETE;
let webhookPATCH: typeof import('../../app/api/admin/webhooks/[id]/route').PATCH;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let leadsPATCH: typeof import('../../app/api/leads/route').PATCH;

beforeAll(async () => {
  mongod = await startTestMongo();
  const webhooksMod = await import('../../app/api/admin/webhooks/route');
  webhooksGET = webhooksMod.GET;
  webhooksPOST = webhooksMod.POST;
  const webhookIdMod = await import('../../app/api/admin/webhooks/[id]/route');
  webhookDELETE = webhookIdMod.DELETE;
  webhookPATCH = webhookIdMod.PATCH;
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  leadsPATCH = leadsMod.PATCH;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  requireSuperAdminSessionMock.mockReset();
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'super-admin-1', email: 'super-admin@test.example.com' });
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

function leadPayload(entityName: string) {
  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    entity_name: entityName,
    url: `https://${slug}.example.com`,
    country: 'US',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [{ name: 'Contact', email: `contact@${slug}.example.com`, isDecisionMaker: true }],
  };
}

// example.com is a real, stable public domain — used here only for its DNS
// resolution to succeed the async SSRF check at registration (issue #210
// §17), never actually sent a request in these admin-route CRUD tests (no
// delivery happens at registration time — see the "delivery worker"
// describe block below, which drives app/lib/webhook-store.ts's delivery
// functions directly with injected network deps instead, so no admin-route
// test ever performs a real outbound POST).
const SAFE_TEST_URL = 'https://example.com/webhooks/slg-test';

async function createWebhook(brand: string, url: string, events: string[]) {
  const res = await webhooksPOST(req('/api/admin/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, url, events }),
  }));
  return { status: res.status, body: await res.json() };
}

describe('POST/GET /api/admin/webhooks (issue 210/219)', () => {
  it('rejects a request the super-admin session check itself rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await webhooksGET(req('/api/admin/webhooks?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('is never x-api-key-accessible — a scoped key cannot substitute for a super-admin session (issue 210 §17)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await webhooksGET(new NextRequest('http://localhost/api/admin/webhooks?brand=cogmap', {
      headers: { 'x-api-key': 'slg_some-key' },
    }));
    expect(res.status).toBe(401);
  });

  it('creates a webhook, returns the raw secret exactly once, and never returns encryptedSecret', async () => {
    const { status, body } = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created', 'lead.won']);
    expect(status).toBe(201);
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.webhook.encryptedSecret).toBeUndefined();
    expect(body.webhook.url).toBe(SAFE_TEST_URL);
    expect(body.webhook.events).toEqual(['lead.created', 'lead.won']);
    expect(body.webhook.consecutiveFailures).toBe(0);
    expect(body.webhook.disabledAt).toBeNull();
  }, 15000);

  it('rejects an http:// (non-https) URL at registration', async () => {
    const { status, body } = await createWebhook('cogmap', 'http://example.com/webhook', ['lead.created']);
    expect(status).toBe(400);
    expect(body.error).toMatch(/https/i);
  });

  it('rejects a private/loopback URL at registration — SSRF defense, issue 210 §17', async () => {
    const { status, body } = await createWebhook('cogmap', 'https://127.0.0.1/webhook', ['lead.created']);
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it('rejects the cloud-metadata address specifically', async () => {
    const { status } = await createWebhook('cogmap', 'https://169.254.169.254/latest/meta-data', ['lead.created']);
    expect(status).toBe(400);
  });

  it('rejects zero events', async () => {
    const { status } = await createWebhook('cogmap', SAFE_TEST_URL, []);
    expect(status).toBe(400);
  });

  it('lists webhooks for a brand, newest first, excluding encryptedSecret', async () => {
    await createWebhook('seyu', SAFE_TEST_URL, ['lead.created']);
    const res = await webhooksGET(req('/api/admin/webhooks?brand=seyu'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.webhooks.length).toBeGreaterThan(0);
    expect(body.webhooks[0].encryptedSecret).toBeUndefined();
  }, 15000);
});

describe('DELETE/PATCH /api/admin/webhooks/[id] (issue 210/219)', () => {
  it('hard-deletes a webhook — it no longer appears in a subsequent listing', async () => {
    const created = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created']);
    const id = created.body.webhook.id;

    const delRes = await webhookDELETE(req(`/api/admin/webhooks/${id}?brand=cogmap`, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    });
    expect(delRes.status).toBe(204);

    const listRes = await webhooksGET(req('/api/admin/webhooks?brand=cogmap'));
    const listBody = await listRes.json();
    expect(listBody.webhooks.find((w: any) => w.id === id)).toBeUndefined();
  }, 15000);

  it('returns 404 deleting an unknown id', async () => {
    const res = await webhookDELETE(req('/api/admin/webhooks/not-a-real-id?brand=cogmap', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'not-a-real-id' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH {enabled:false} disables a webhook; {enabled:true} re-enables and resets consecutiveFailures', async () => {
    const created = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created']);
    const id = created.body.webhook.id;

    const disableRes = await webhookPATCH(req(`/api/admin/webhooks/${id}?brand=cogmap`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    }), { params: Promise.resolve({ id }) });
    expect(disableRes.status).toBe(204);

    let listBody = await (await webhooksGET(req('/api/admin/webhooks?brand=cogmap'))).json();
    let row = listBody.webhooks.find((w: any) => w.id === id);
    expect(row.disabledAt).not.toBeNull();
    expect(row.disabledReason).toMatch(/manually disabled/);

    const enableRes = await webhookPATCH(req(`/api/admin/webhooks/${id}?brand=cogmap`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    }), { params: Promise.resolve({ id }) });
    expect(enableRes.status).toBe(204);

    listBody = await (await webhooksGET(req('/api/admin/webhooks?brand=cogmap'))).json();
    row = listBody.webhooks.find((w: any) => w.id === id);
    expect(row.disabledAt).toBeNull();
  }, 15000);
});

// The delivery worker's own network boundary (DNS resolution, the outbound
// signed POST) is exercised directly against app/lib/webhook-store.ts's
// exported functions with injected WebhookNetworkDeps — a stub resolveIp
// and a stub performPost recording every call — rather than through the
// HTTP route layer or a real external receiver, mirroring
// tests/lib/tech-stack-scan.test.ts's own injectable-deps testing pattern
// for exactly the same reason (deterministic, no real network I/O, no
// flakiness from an unreachable stub server).
describe('emitWebhookEvent + processWebhookDeliveries end-to-end (issue 210/219)', () => {
  async function db() {
    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    return client.db();
  }

  const FAKE_IP = { address: '93.184.216.34', family: 4 as const };

  it('a lead create enqueues a lead.created delivery, and the worker delivers it with a valid signature', async () => {
    const created = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created']);
    const secret = created.body.secret;

    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload('Webhook E2E Create Co')),
    }));
    expect(leadRes.status).toBe(201);

    const database = await db();
    // Scoped to THIS test's own webhook id — other tests in this file also
    // register 'cogmap' + lead.created subscribers against the same
    // SAFE_TEST_URL and stay active afterward (a toggled-back-on webhook,
    // in particular), so a plain `{event: 'lead.created'}` query would pick
    // up an unrelated delivery from a different webhook/secret.
    const myDelivery = await database.collection('webhook_deliveries').findOne({ webhookId: created.body.webhook.id, event: 'lead.created' });
    expect(myDelivery).toBeTruthy();
    expect(myDelivery!.status).toBe('pending');

    const calls: any[] = [];
    const { processWebhookDeliveries } = await import('../../app/lib/webhook-store');
    const summary = await processWebhookDeliveries(database, new Date(), {
      resolveIp: async () => FAKE_IP,
      performPost: async (url, ip, body, headers) => {
        calls.push({ url: url.toString(), ip, body, headers });
        return { statusCode: 200 };
      },
    });

    expect(summary.delivered).toBeGreaterThan(0);
    const call = calls.find((c) => c.headers['webhook-id'] === myDelivery!.id);
    expect(call).toBeTruthy();
    expect(call.url).toBe(SAFE_TEST_URL);
    const parsed = JSON.parse(call.body);
    expect(parsed.event).toBe('lead.created');
    expect(parsed.brand).toBe('cogmap');

    const verified = verifyWebhookSignature(secret, call.headers['webhook-id'], Number(call.headers['webhook-timestamp']), call.body, call.headers['webhook-signature']);
    expect(verified).toBe(true);

    const delivered = await database.collection('webhook_deliveries').findOne({ id: call.headers['webhook-id'] });
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.httpStatus).toBe(200);
  }, 20000);

  it('a WON stage change fires both lead.stage_changed and lead.won', async () => {
    await createWebhook('cogmap', SAFE_TEST_URL, ['lead.stage_changed', 'lead.won']);

    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload('Webhook E2E Won Co')),
    }));
    const created = await leadRes.json();
    const id = created.lead._id || created.lead.id;

    const moveRes = await leadsPATCH(req(`/api/leads?brand=cogmap&id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'COLUMN_MOVE', kanbanColumn: 'WON', sortOrder: Date.now() }),
    }));
    expect(moveRes.status).toBe(200);

    const database = await db();
    const stageChanged = await database.collection('webhook_deliveries').find({ event: 'lead.stage_changed' }).toArray();
    const won = await database.collection('webhook_deliveries').find({ event: 'lead.won' }).toArray();
    expect(stageChanged.length).toBeGreaterThan(0);
    expect(won.length).toBeGreaterThan(0);
  }, 20000);

  it('a DECLINE fires lead.lost', async () => {
    await createWebhook('cogmap', SAFE_TEST_URL, ['lead.lost']);

    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload('Webhook E2E Lost Co')),
    }));
    const created = await leadRes.json();
    const id = created.lead._id || created.lead.id;

    const declineRes = await leadsPATCH(req(`/api/leads?brand=cogmap&id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'DECLINE', declineReason: 'BUDGET_CONSTRAINTS' }),
    }));
    expect(declineRes.status).toBe(200);

    const database = await db();
    const lost = await database.collection('webhook_deliveries').find({ event: 'lead.lost' }).toArray();
    expect(lost.length).toBeGreaterThan(0);
  }, 20000);

  it('a brand with zero matching subscriptions enqueues nothing (cheap no-op)', async () => {
    const database = await db();
    const before = await database.collection('webhook_deliveries').countDocuments({ brand: 'dvsc' });

    const leadRes = await leadsPOST(req('/api/leads?brand=dvsc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload('Webhook E2E No Subscribers Co')),
    }));
    expect(leadRes.status).toBe(201);

    const after = await database.collection('webhook_deliveries').countDocuments({ brand: 'dvsc' });
    expect(after).toBe(before);
  }, 15000);

  it('retries a failing delivery on the documented schedule and stops advancing once exhausted', async () => {
    const created = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created']);
    await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload('Webhook E2E Retry Co')),
    }));

    const database = await db();
    const { processWebhookDeliveries } = await import('../../app/lib/webhook-store');
    const alwaysFail = { resolveIp: async () => FAKE_IP, performPost: async () => ({ statusCode: 500 }) };

    // Only re-process THIS test's own delivery — find it fresh each round,
    // scoped to this webhook id, so an earlier test's own rows (also
    // subscribed to lead.created against the same SAFE_TEST_URL) are never
    // touched by this test's repeated ticks.
    const delivery = await database.collection('webhook_deliveries').findOne({ webhookId: created.body.webhook.id, event: 'lead.created' });
    expect(delivery).toBeTruthy();

    let now = new Date();
    for (let round = 1; round <= 5; round++) {
      // Force this round's due delivery to be eligible right now, without
      // waiting for real wall-clock time to pass through the real 1m/5m/
      // 30m/2h/12h schedule.
      await database.collection('webhook_deliveries').updateOne({ id: delivery!.id }, { $set: { nextAttemptAt: now.toISOString() } });
      await processWebhookDeliveries(database, now, alwaysFail);
      now = new Date(now.getTime() + 1000);
    }

    const finalDoc = await database.collection('webhook_deliveries').findOne({ id: delivery!.id });
    expect(finalDoc?.status).toBe('exhausted');
    expect(finalDoc?.attempt).toBe(5);

    const webhookDoc = await database.collection('webhooks').findOne({ id: created.body.webhook.id });
    expect(webhookDoc?.consecutiveFailures).toBe(1);
    expect(webhookDoc?.disabledAt).toBeNull();
  }, 30000);

  it('auto-disables a webhook after 5 consecutive fully-exhausted deliveries', async () => {
    const created = await createWebhook('cogmap', SAFE_TEST_URL, ['lead.created']);
    const database = await db();
    const { processWebhookDeliveries } = await import('../../app/lib/webhook-store');
    const alwaysFail = { resolveIp: async () => FAKE_IP, performPost: async () => ({ statusCode: 500 }) };

    let now = new Date();
    // 5 independently-generated leads, each producing one delivery for this
    // webhook; exhaust each one in a single tick by pre-advancing its
    // attempt count directly rather than re-running the full 5-attempt
    // backoff per delivery (already covered by the retry-schedule test
    // above) — this test's own concern is the dead-letter threshold across
    // deliveries, not the per-delivery schedule.
    for (let i = 0; i < 5; i++) {
      await leadsPOST(req('/api/leads?brand=cogmap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload(`Webhook E2E Disable Co ${i}`)),
      }));
      const delivery = await database.collection('webhook_deliveries').findOne(
        { webhookId: created.body.webhook.id, event: 'lead.created', status: 'pending' },
        { sort: { createdAt: -1 } }
      );
      await database.collection('webhook_deliveries').updateOne({ id: delivery!.id }, { $set: { attempt: 5, nextAttemptAt: now.toISOString() } });
      await processWebhookDeliveries(database, now, alwaysFail);
      now = new Date(now.getTime() + 1000);
    }

    const webhookDoc = await database.collection('webhooks').findOne({ id: created.body.webhook.id });
    expect(webhookDoc?.consecutiveFailures).toBe(5);
    expect(webhookDoc?.disabledAt).not.toBeNull();
    expect(webhookDoc?.disabledReason).toMatch(/auto-disabled/);
  }, 30000);
});
