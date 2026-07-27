import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #111: GET /api/forecast/export hardcoded brand to 'cogmap' and never
// read a brand query param at all — exporting from the Seyu forecast page
// silently downloaded CogMap's pipeline data. Now delegates to the same
// computeForecast() the on-page Forecast/board API already use.

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let exportGET: typeof import('../../app/api/forecast/export/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  leadsPOST = (await import('../../app/api/leads/route')).POST;
  exportGET = (await import('../../app/api/forecast/export/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: ConstructorParameters<typeof import('next/server').NextRequest>[1]) {
  return buildApiRequest(url, init);
}

async function seedCogmapLead(): Promise<void> {
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: 'Cogmap Export FC',
      url: 'https://cogmap-export-fc.example.com',
      country: 'US',
      kanbanColumn: 'WON',
      ice: { impact: 8, confidence: 8, ease: 8 },
      contacts: [{ name: 'Jordan Smith', email: 'jordan@cogmap-export-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
      estimated_annual_revenue_usd: 40000,
    }),
  }));
  expect(res.status).toBe(201);
}

async function seedSeyuLead(): Promise<void> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  await db.collection('seyu_leads').insertOne({
    entity_name: 'Seyu Export FC',
    tenantId: 'default',
    kanbanColumn: 'WON',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    pricingByCompany: { 'Seyu Export FC': { annual_fee_eur: 25000, currency: 'EUR' } },
  });
}

// Issue #114 — a lead's manually-managed deals[] takes priority over both
// ticketSizeEstimate.expected and the legacy estimated_annual_revenue_usd
// once at least one deal exists.
async function seedCogmapLeadWithDeal(): Promise<void> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  // Deliberately ENGAGED, not WON — the sibling describe block below seeds
  // its own WON cogmap lead and asserts an exact rawRevenue sum for that
  // column; sharing one in-memory Mongo instance for the whole file (see
  // beforeAll) means a second WON lead here would silently change that
  // other test's expected total.
  await db.collection('leads').insertOne({
    entity_name: 'Deal Priority FC',
    tenantId: 'default',
    kanbanColumn: 'ENGAGED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    estimated_annual_revenue_usd: 999999,
    ticketSizeEstimate: { method: 'tier_band', computedAt: new Date().toISOString(), expected: 888888, currency: 'USD' },
    deals: [
      { id: 'd1', value: 12000, currency: 'USD', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'manual' },
      { id: 'd2', value: 3000, currency: 'USD', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'manual' },
    ],
  });
}

describe('GET /api/forecast/export — deals take priority (issue #114)', () => {
  it('sums deals[] instead of using ticketSizeEstimate or the legacy revenue field', async () => {
    await seedCogmapLeadWithDeal();
    const res = await exportGET(req('/api/forecast/export?format=json&brand=cogmap'));
    const body = await res.json();
    const engaged = body.pipeline.find((row: any) => row.column === 'ENGAGED');
    expect(engaged.rawRevenue).toBe(15000);
    expect(engaged.rawRevenue).not.toBe(999999);
    expect(engaged.rawRevenue).not.toBe(888888);
  });
});

describe('GET /api/forecast/export', () => {
  it('exports the requested brand, not always cogmap', async () => {
    await seedCogmapLead();
    await seedSeyuLead();

    const cogmapRes = await exportGET(req('/api/forecast/export?format=csv&brand=cogmap'));
    const cogmapBody = await cogmapRes.text();
    expect(cogmapRes.headers.get('Content-Disposition')).toContain('cogmap-forecast.csv');
    expect(cogmapBody).toContain('40000'); // WON has probability 1.0, so raw and weighted both show 40000
    expect(cogmapBody).not.toContain('25000');

    const seyuRes = await exportGET(req('/api/forecast/export?format=csv&brand=seyu'));
    const seyuBody = await seyuRes.text();
    expect(seyuRes.headers.get('Content-Disposition')).toContain('seyu-forecast.csv');
    expect(seyuBody).toContain('25000');
    expect(seyuBody).not.toContain('40000');
  });

  it('defaults to cogmap when no brand is given, for backward compatibility', async () => {
    const res = await exportGET(req('/api/forecast/export?format=csv'));
    expect(res.headers.get('Content-Disposition')).toContain('cogmap-forecast.csv');
  });

  it('json format includes the resolved brand and matches the CSV numbers', async () => {
    const res = await exportGET(req('/api/forecast/export?format=json&brand=seyu'));
    const body = await res.json();
    expect(body.brand).toBe('seyu');
    const won = body.pipeline.find((row: any) => row.column === 'WON');
    expect(won.rawRevenue).toBe(25000);
  });
});
