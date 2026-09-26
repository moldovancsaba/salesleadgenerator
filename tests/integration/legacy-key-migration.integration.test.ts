import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest, TEST_API_KEY } from './helpers/api-request';

// Issue #220: the research agent's PUT /api/leads/[id] accepts a scoped key,
// and every accepted use of the shared key is recorded so the owner can
// prove it is unused before deleting it.

const requireSuperAdminSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/session')>()),
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
}));

let mongod: MongoMemoryServer;
let PUT: typeof import('../../app/api/leads/[id]/route').PUT;
let usageGET: typeof import('../../app/api/admin/api-keys/legacy-usage/route').GET;
let leadId: string;
const keys: Record<string, string> = {};

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  return (await clientPromise).db();
}

beforeAll(async () => {
  mongod = await startTestMongo();
  PUT = (await import('../../app/api/leads/[id]/route')).PUT;
  usageGET = (await import('../../app/api/admin/api-keys/legacy-usage/route')).GET;
  const database = await db();
  leadId = (await database.collection('leads').insertOne({
    entity_name: 'Scoped Key FC', url: 'https://scoped-key.example.com', country: 'US', region: 'US',
    tenantId: 'default', kanbanColumn: 'DISCOVERED', contacts: [], createdAt: new Date(), updatedAt: new Date(),
  })).insertedId.toString();
  const { createApiKey } = await import('../../app/lib/api-key-store');
  keys.cogmapWrite = (await createApiKey(database, { name: 'agent-cogmap', brand: 'cogmap', scopes: ['read-write'] }, 'test')).rawKey;
  keys.cogmapRead = (await createApiKey(database, { name: 'reader-cogmap', brand: 'cogmap', scopes: ['read'] }, 'test')).rawKey;
  keys.seyuWrite = (await createApiKey(database, { name: 'agent-seyu', brand: 'seyu', scopes: ['read-write'] }, 'test')).rawKey;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function put(key: string | null, notes: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  return PUT(new NextRequest(`http://localhost/api/leads/${leadId}?brand=cogmap`, {
    method: 'PUT', headers, body: JSON.stringify({ notes }),
  }), { params: Promise.resolve({ id: leadId }) });
}

describe('PUT /api/leads/[id] with scoped keys (issue 220)', () => {
  it('accepts a read-write scoped key for the lead\'s brand', async () => {
    const res = await put(keys.cogmapWrite, 'written with a scoped key');
    expect(res.status).toBe(200);
    const stored = await (await db()).collection('leads').findOne({ entity_name: 'Scoped Key FC' });
    expect(stored?.notes).toBe('written with a scoped key');
  });

  it('refuses a read-only key, another brand\'s key, and no key', async () => {
    expect((await put(keys.cogmapRead, 'nope')).status).toBe(403);
    expect((await put(keys.seyuWrite, 'nope')).status).toBe(403);
    expect((await put(null, 'nope')).status).toBe(401);
    expect((await put('slg_not_a_real_key', 'nope')).status).toBe(401);
    const stored = await (await db()).collection('leads').findOne({ entity_name: 'Scoped Key FC' });
    expect(stored?.notes).toBe('written with a scoped key');
  });

  it('still accepts the shared key', async () => {
    expect((await put(TEST_API_KEY, 'written with the shared key')).status).toBe(200);
  });
});

describe('shared-key usage recording (issue 220)', () => {
  it('buckets uses per day, method and route, collapsing ids', async () => {
    const { recordLegacyKeyUseNow, summarizeLegacyKeyUsage } = await import('../../lib/legacy-key-usage');
    const database = await db();
    const when = new Date();
    await recordLegacyKeyUseNow(database, 'PUT', 'http://localhost/api/leads/0123456789abcdef01234567?brand=seyu', 'agent/1.0', when);
    await recordLegacyKeyUseNow(database, 'PUT', 'http://localhost/api/leads/fedcba9876543210fedcba98?brand=seyu', 'agent/1.0', when);
    const bucket = await database.collection('legacy_api_key_usage').findOne({ method: 'PUT', path: '/api/leads/:id', day: when.toISOString().slice(0, 10) });
    expect(bucket?.count).toBeGreaterThanOrEqual(2);
    const summary = await summarizeLegacyKeyUsage(database, 30);
    expect(summary.find((s) => s.path === '/api/leads/:id' && s.method === 'PUT')).toBeTruthy();
  });

  it('records a real shared-key request made through an auth helper', async () => {
    await put(TEST_API_KEY, 'recorded use');
    const database = await db();
    await vi.waitFor(async () => {
      const bucket = await database.collection('legacy_api_key_usage').findOne({ method: 'PUT', path: '/api/leads/:id' });
      expect(bucket?.count).toBeGreaterThanOrEqual(3);
    });
  });

  it('does not record a scoped-key request', async () => {
    const database = await db();
    const before = (await database.collection('legacy_api_key_usage').findOne({ method: 'PUT', path: '/api/leads/:id' }))?.count;
    await put(keys.cogmapWrite, 'scoped again');
    await new Promise((r) => setTimeout(r, 200));
    const after = (await database.collection('legacy_api_key_usage').findOne({ method: 'PUT', path: '/api/leads/:id' }))?.count;
    expect(after).toBe(before);
  });

  it('serves the summary to a super-admin session only', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    expect((await usageGET(buildApiRequest('/api/admin/api-keys/legacy-usage'))).status).toBe(401);
    requireSuperAdminSessionMock.mockResolvedValueOnce({ sub: 'admin', email: 'admin@test.example.com' });
    const res = await usageGET(new NextRequest('http://localhost/api/admin/api-keys/legacy-usage?days=7'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(7);
    expect(body.usage.some((u: any) => u.path === '/api/leads/:id')).toBe(true);
  });
});
