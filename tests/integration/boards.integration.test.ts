import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

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
    const res = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Forecast Test FC',
        url: 'https://forecast-test-fc.example.com',
        country: 'US',
        kanbanColumn: 'WON',
        ice: { impact: 8, confidence: 8, ease: 8 },
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
    await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Discovered Forecast FC',
        url: 'https://discovered-forecast-fc.example.com',
        country: 'US',
        kanbanColumn: 'DISCOVERED',
        ice: { impact: 2, confidence: 2, ease: 2 },
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
});
