import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/admin/forecast-snapshot/route').GET;
let POST: typeof import('../../app/api/admin/forecast-snapshot/route').POST;
let historyGET: typeof import('../../app/api/admin/forecast-snapshot/history/route').GET;
let leadsPOST: typeof import('../../app/api/leads/route').POST;

const TEST_API_KEY = 'test-forecast-snapshot-key';
const TEST_CRON_SECRET = 'test-cron-secret';

beforeAll(async () => {
  mongod = await startTestMongo();
  // lib/api-auth.ts reads SLG_API_KEY/CRON_SECRET once at module load, same
  // constraint as lib/mongodb.ts's MONGODB_URI (see mongo-test-server.ts) —
  // must be set before the first dynamic import of any route that imports it.
  process.env.SLG_API_KEY = TEST_API_KEY;
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  const mod = await import('../../app/api/admin/forecast-snapshot/route');
  GET = mod.GET;
  POST = mod.POST;
  const historyMod = await import('../../app/api/admin/forecast-snapshot/history/route');
  historyGET = historyMod.GET;
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
}, 60000);

afterAll(async () => {
  delete process.env.SLG_API_KEY;
  delete process.env.CRON_SECRET;
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

function authedReq(url: string, init?: RequestInit) {
  return req(url, { ...init, headers: { ...(init?.headers || {}), 'x-api-key': TEST_API_KEY } });
}

// Issue #127 — POST /api/leads moved from Request to NextRequest (it now
// checks request.cookies via requireBrandAccessApi, same as PATCH already
// did). This file's own authedReq() above stays a plain Request for the
// routes that don't need that; this is the one call site that does.
function authedNextReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, { ...init, headers: { ...(init?.headers || {}), 'x-api-key': TEST_API_KEY } });
}

function cronReq(url: string, init?: RequestInit) {
  return req(url, { ...init, headers: { ...(init?.headers || {}), authorization: `Bearer ${TEST_CRON_SECRET}` } });
}

describe('GET /api/admin/forecast-snapshot — auth', () => {
  it('rejects a request with no auth', async () => {
    const res = await GET(req('/api/admin/forecast-snapshot'));
    expect(res.status).toBe(401);
  });

  it('rejects a request with a wrong x-api-key', async () => {
    const res = await GET(req('/api/admin/forecast-snapshot', { headers: { 'x-api-key': 'wrong' } }));
    expect(res.status).toBe(401);
  });

  it('accepts the Vercel Cron bearer secret', async () => {
    const res = await GET(cronReq('/api/admin/forecast-snapshot'));
    expect(res.status).toBe(200);
  });

  it('accepts the admin x-api-key', async () => {
    const res = await GET(authedReq('/api/admin/forecast-snapshot'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/forecast-snapshot — write behavior', () => {
  it('writes an all-zero snapshot for a brand with zero leads, correct shape for both brands', async () => {
    const res = await GET(cronReq('/api/admin/forecast-snapshot'));
    const body = await res.json();
    expect(body.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.failures).toEqual([]);

    const cogmapDefault = body.results.find((r: any) => r.brand === 'cogmap' && r.tenantId === 'default');
    const seyuDefault = body.results.find((r: any) => r.brand === 'seyu' && r.tenantId === 'default');
    expect(cogmapDefault).toMatchObject({ status: 'written', totalWeightedRevenue: 0 });
    expect(seyuDefault).toMatchObject({ status: 'written', totalWeightedRevenue: 0 });
  });

  it('is idempotent — a second write in the same period upserts, never duplicates', async () => {
    await GET(cronReq('/api/admin/forecast-snapshot'));
    await GET(cronReq('/api/admin/forecast-snapshot'));

    const historyRes = await historyGET(authedReq('/api/admin/forecast-snapshot/history?brand=cogmap&tenantId=default'));
    const historyBody = await historyRes.json();
    expect(historyBody.count).toBe(1);
  });

  it('captures the real forecast shape once a lead exists, and persists weightsUsed', async () => {
    await leadsPOST(authedNextReq('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Snapshot Test FC',
        url: 'https://snapshot-test-fc.example.com',
        country: 'US',
        kanbanColumn: 'WON',
        ice: { impact: 8, confidence: 8, ease: 8 },
        estimated_annual_revenue_usd: 20000,
      }),
    }));

    const res = await GET(cronReq('/api/admin/forecast-snapshot'));
    const body = await res.json();
    const cogmapDefault = body.results.find((r: any) => r.brand === 'cogmap' && r.tenantId === 'default');
    expect(cogmapDefault.totalWeightedRevenue).toBe(20000);

    const historyRes = await historyGET(authedReq('/api/admin/forecast-snapshot/history?brand=cogmap&tenantId=default'));
    const historyBody = await historyRes.json();
    expect(historyBody.count).toBe(1);
    expect(historyBody.snapshots[0].forecast.pipeline.WON.rawRevenue).toBe(20000);
    expect(historyBody.snapshots[0].weightsUsed).toBeDefined();
    expect(historyBody.snapshots[0].source).toBe('vercel-cron');
  });
});

describe('POST /api/admin/forecast-snapshot — backfill', () => {
  it('tags an explicit periodKey as source=backfill and does not collide with the current week', async () => {
    const res = await POST(authedReq('/api/admin/forecast-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodKey: '2020-W01', tenantId: 'default' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('backfill');
    expect(body.periodKey).toBe('2020-W01');

    const historyRes = await historyGET(authedReq('/api/admin/forecast-snapshot/history?brand=cogmap&tenantId=default&limit=200'));
    const historyBody = await historyRes.json();
    expect(historyBody.count).toBeGreaterThanOrEqual(2);
    expect(historyBody.snapshots.some((s: any) => s.periodKey === '2020-W01' && s.source === 'backfill')).toBe(true);
  });

  it('rejects a request with no auth', async () => {
    const res = await POST(req('/api/admin/forecast-snapshot', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/forecast-snapshot/history', () => {
  it('respects the limit param', async () => {
    const res = await historyGET(authedReq('/api/admin/forecast-snapshot/history?brand=cogmap&tenantId=default&limit=1'));
    const body = await res.json();
    expect(body.snapshots.length).toBeLessThanOrEqual(1);
  });

  it('respects from/to date-range params', async () => {
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const res = await historyGET(authedReq(`/api/admin/forecast-snapshot/history?brand=cogmap&tenantId=default&from=${farFuture}`));
    const body = await res.json();
    expect(body.count).toBe(0);
  });

  it('requires brand', async () => {
    const res = await historyGET(authedReq('/api/admin/forecast-snapshot/history?tenantId=default'));
    expect(res.status).toBe(400);
  });

  it('rejects a request with no auth', async () => {
    const res = await historyGET(req('/api/admin/forecast-snapshot/history?brand=cogmap'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/forecast-snapshot — unconfigured', () => {
  it('returns 503 when MONGODB_URI is unset', async () => {
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    try {
      const res = await GET(cronReq('/api/admin/forecast-snapshot'));
      expect(res.status).toBe(503);
    } finally {
      process.env.MONGODB_URI = original;
    }
  });
});
