import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Quota tracking (issue #204) — target CRUD is requireSuperAdminSession-
// gated (same as app/api/admin/teams/route.ts); attainment is session-only
// (self always allowed, cross-user needs brand-admin role). Neither can be
// exercised with a real signed SSO JWT in this sandbox, so lib/session.ts is
// mocked at the module boundary — same established pattern as
// tests/integration/teams.integration.test.ts and leads-bulk's own ASSIGN
// coverage, not a forged token.
const requireSuperAdminSessionMock = vi.fn();
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let quotaGET: typeof import('../../app/api/quota/[brand]/route').GET;
let quotaPUT: typeof import('../../app/api/quota/[brand]/route').PUT;
let attainmentGET: typeof import('../../app/api/quota/[brand]/attainment/route').GET;
let leadsPATCH: typeof import('../../app/api/leads/route').PATCH;

beforeAll(async () => {
  mongod = await startTestMongo();
  const quotaMod = await import('../../app/api/quota/[brand]/route');
  quotaGET = quotaMod.GET;
  quotaPUT = quotaMod.PUT;
  attainmentGET = (await import('../../app/api/quota/[brand]/attainment/route')).GET;
  leadsPATCH = (await import('../../app/api/leads/route')).PATCH;
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

// No x-api-key — forces requireBrandAccessApi through its session branch,
// same helper/reasoning as tests/integration/teams.integration.test.ts.
function sessionReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

async function quotaDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const database = await quotaDb();
  const now = new Date().toISOString();
  await database.collection('sso_user_access').insertOne({
    ssoUserId: overrides.ssoUserId,
    email: overrides.email,
    orgAccess: overrides.orgAccess,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertLead(overrides: Record<string, unknown> = {}): Promise<string> {
  const database = await quotaDb();
  const result = await database.collection('leads').insertOne({
    entity_name: 'Quota Test Co',
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

// Moves a lead to WON through the real PATCH handler (so a real outcomelogs
// entry gets written, exactly like app/lib/quota-store.ts's
// getQuotaAttainment() expects to find), then backdates that entry's
// createdAt to a known test date — direct Mongo manipulation for
// deterministic period-boundary testing, same established technique as
// tests/integration/leads-bulk.integration.test.ts's own 410-expiry test.
async function moveToWonAt(leadId: string, wonAt: Date) {
  const res = await leadsPATCH(req(`/api/leads?id=${leadId}&brand=cogmap`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'COLUMN_MOVE', kanbanColumn: 'WON', sortOrder: Date.now() }),
  }));
  if (res.status !== 200) {
    throw new Error(`moveToWonAt(${leadId}) failed: ${res.status} ${JSON.stringify(await res.json())}`);
  }
  const database = await quotaDb();
  await database.collection('outcomelogs').updateMany(
    { leadId, 'afterState.kanbanColumn': 'WON' },
    { $set: { createdAt: wonAt } }
  );
}

describe('GET/PUT /api/quota/[brand]', () => {
  it('rejects a request the super-admin session check itself rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await quotaGET(req('/api/quota/cogmap'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(401);
  });

  it('rejects a PUT with an invalid period for the given periodType', async () => {
    const res = await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-1', periodType: 'monthly', period: '2026-Q3', amount: 10000, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(400);
  });

  it('rejects a negative amount', async () => {
    const res = await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-1', periodType: 'monthly', period: '2026-09', amount: -5, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(400);
  });

  it('creates then retrieves a quota target, stamped with the setting admin', async () => {
    const putRes = await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-quota-1', periodType: 'monthly', period: '2026-09', amount: 50000, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.target.amount).toBe(50000);
    expect(putBody.target.setBy).toBe('super-admin-1');

    const getRes = await quotaGET(req('/api/quota/cogmap?userId=rep-quota-1&period=2026-09'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const getBody = await getRes.json();
    expect(getBody.target.amount).toBe(50000);
  });

  it('upserts on a second PUT for the same {brand, userId, period} rather than duplicating', async () => {
    await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-quota-2', periodType: 'monthly', period: '2026-10', amount: 10000, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-quota-2', periodType: 'monthly', period: '2026-10', amount: 20000, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });

    const listRes = await quotaGET(req('/api/quota/cogmap?userId=rep-quota-2&period=2026-10'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const listBody = await listRes.json();
    expect(listBody.target.amount).toBe(20000);

    const allRes = await quotaGET(req('/api/quota/cogmap?userId=rep-quota-2'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const allBody = await allRes.json();
    expect(allBody.targets.filter((t: any) => t.period === '2026-10')).toHaveLength(1);
  });
});

describe('GET /api/quota/[brand]/attainment', () => {
  it('401s with no resolvable session', async () => {
    const res = await attainmentGET(req('/api/quota/cogmap/attainment?userId=rep-1&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(401);
  });

  it('400s on an invalid period for the given periodType', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-1', email: 'rep-att-1@test.example.com', orgAccess: { cogmap: 'user' } });
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-1', email: 'rep-att-1@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=rep-att-1&period=2026-Q3&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(400);
  });

  it('a rep can always view their own attainment', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-2', email: 'rep-att-2@test.example.com', orgAccess: { cogmap: 'user' } });
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-2', email: 'rep-att-2@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=rep-att-2&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attainment.userId).toBe('rep-att-2');
  });

  it('a non-admin cannot view another user\'s attainment (403)', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-3', email: 'rep-att-3@test.example.com', orgAccess: { cogmap: 'user' } });
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-3', email: 'rep-att-3@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=someone-else&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(403);
  });

  it('a brand admin can view another user\'s attainment', async () => {
    await seedUserAccess({ ssoUserId: 'brand-admin-att-1', email: 'brand-admin-att-1@test.example.com', orgAccess: { cogmap: 'admin' } });
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'brand-admin-att-1', email: 'brand-admin-att-1@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=some-rep&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);
  });

  it('sums real closed-won revenue for leads WON inside the period and excludes leads WON outside it', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-attain-1', email: 'rep-att-attain-1@test.example.com', orgAccess: { cogmap: 'user' } });
    const inPeriodLead = await insertLead({ assignedTo: 'rep-att-attain-1', actualDealValueUsd: 12000 });
    const outsidePeriodLead = await insertLead({ assignedTo: 'rep-att-attain-1', actualDealValueUsd: 99999 });
    const otherRepLead = await insertLead({ assignedTo: 'someone-else-entirely', actualDealValueUsd: 5000 });

    await moveToWonAt(inPeriodLead, new Date('2026-09-15T00:00:00Z'));
    await moveToWonAt(outsidePeriodLead, new Date('2026-08-15T00:00:00Z'));
    await moveToWonAt(otherRepLead, new Date('2026-09-15T00:00:00Z'));

    await quotaPUT(req('/api/quota/cogmap', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'rep-att-attain-1', periodType: 'monthly', period: '2026-09', amount: 24000, currency: 'USD' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-attain-1', email: 'rep-att-attain-1@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=rep-att-attain-1&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attainment.attained).toBe(12000);
    expect(body.attainment.leadCount).toBe(1);
    expect(body.attainment.quotaAmount).toBe(24000);
    expect(body.attainment.attainmentPercent).toBe(50);
  });

  it('falls back to ticketSizeEstimate.expected when actualDealValueUsd was never captured', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-fallback-1', email: 'rep-att-fallback-1@test.example.com', orgAccess: { cogmap: 'user' } });
    const lead = await insertLead({ assignedTo: 'rep-att-fallback-1', ticketSizeEstimate: { method: 'tier_band', computedAt: new Date().toISOString(), expected: 8000 } });
    await moveToWonAt(lead, new Date('2026-09-10T00:00:00Z'));

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-fallback-1', email: 'rep-att-fallback-1@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=rep-att-fallback-1&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const body = await res.json();
    expect(body.attainment.attained).toBe(8000);
  });

  it('reports null quotaAmount/attainmentPercent when no quota target has been set for the period', async () => {
    await seedUserAccess({ ssoUserId: 'rep-att-noquota-1', email: 'rep-att-noquota-1@test.example.com', orgAccess: { cogmap: 'user' } });
    const lead = await insertLead({ assignedTo: 'rep-att-noquota-1', actualDealValueUsd: 1000 });
    await moveToWonAt(lead, new Date('2026-09-10T00:00:00Z'));

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'rep-att-noquota-1', email: 'rep-att-noquota-1@test.example.com' });
    const res = await attainmentGET(sessionReq('/api/quota/cogmap/attainment?userId=rep-att-noquota-1&period=2026-09&periodType=monthly'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const body = await res.json();
    expect(body.attainment.quotaAmount).toBeNull();
    expect(body.attainment.attainmentPercent).toBeNull();
  });
});
