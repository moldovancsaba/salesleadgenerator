import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let boardsGET: typeof import('../../app/api/boards/[brand]/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  const boardsMod = await import('../../app/api/boards/[brand]/route');
  boardsGET = boardsMod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

describe('GET /api/boards/[brand] — cogmap forecast', () => {
  it('computes weighted revenue using the real default pipeline weight for WON (1.0 — no discount)', async () => {
    const res = await leadsPOST(buildApiRequest('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Forecast Test FC',
        url: 'https://forecast-test-fc.example.com',
        country: 'US',
        kanbanColumn: 'WON',
        ice: { impact: 8, confidence: 8, ease: 8 },
        contacts: [{ name: 'Jordan Smith', email: 'jordan@forecast-test-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
        estimated_annual_revenue_usd: 50000,
      }),
    }));
    expect(res.status).toBe(201);

    const boardRes = await boardsGET(
      req('/api/boards/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(boardRes.status).toBe(200);
    const body = await boardRes.json();
    expect(body.forecast.pipeline.WON.rawRevenue).toBe(50000);
    // Default pipeline weight for WON is 1.0 -> weighted revenue equals raw revenue exactly.
    expect(body.forecast.pipeline.WON.weightedRevenue).toBe(50000);
    expect(body.forecast.pipeline.WON.probability).toBe(1);
  });

  it('applies the 0.01 default weight to a DISCOVERED lead (99% discounted)', async () => {
    await leadsPOST(buildApiRequest('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Discovered Forecast FC',
        url: 'https://discovered-forecast-fc.example.com',
        country: 'US',
        kanbanColumn: 'DISCOVERED',
        ice: { impact: 2, confidence: 2, ease: 2 },
        contacts: [{ name: 'Jordan Smith', email: 'jordan@discovered-forecast-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
        estimated_annual_revenue_usd: 10000,
      }),
    }));

    const boardRes = await boardsGET(
      req('/api/boards/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    const body = await boardRes.json();
    expect(body.forecast.pipeline.DISCOVERED.rawRevenue).toBe(10000);
    expect(body.forecast.pipeline.DISCOVERED.weightedRevenue).toBe(100); // 10000 * 0.01
  });

  // Issue #126 — a BACKLOG lead is deliberately parked and must never
  // contribute to the brand's revenue totals. `forecast.totals.revenue` is
  // computeForecast()'s own grand-total aggregation (distinct from
  // `forecast.pipeline`, which is already keyed by a fixed 6-column list
  // that structurally excludes BACKLOG) — this is the field the
  // revenueFilter fix in app/lib/forecast.ts actually targets.
  it('excludes a BACKLOG lead from forecast.totals.revenue', async () => {
    const before = await boardsGET(
      req('/api/boards/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    const beforeBody = await before.json();
    const revenueBefore = beforeBody.forecast.totals.revenue;

    const res = await leadsPOST(buildApiRequest('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Backlog Forecast FC',
        url: 'https://backlog-forecast-fc.example.com',
        country: 'US',
        kanbanColumn: 'BACKLOG',
        ice: { impact: 5, confidence: 5, ease: 5 },
        contacts: [{ name: 'Jordan Smith', email: 'jordan@backlog-forecast-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
        estimated_annual_revenue_usd: 777777,
      }),
    }));
    expect(res.status).toBe(201);

    const after = await boardsGET(
      req('/api/boards/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(after.status).toBe(200);
    const afterBody = await after.json();
    // A $777,777 BACKLOG lead was just created — if the revenueFilter fix
    // were absent, forecast.totals.revenue would jump by exactly that much.
    expect(afterBody.forecast.totals.revenue).toBe(revenueBefore);
    expect(afterBody.forecast.totals.revenue).not.toBe(revenueBefore + 777777);
  });
});
