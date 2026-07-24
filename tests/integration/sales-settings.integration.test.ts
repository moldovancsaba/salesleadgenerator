import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/sales-settings/[brand]/route').GET;
let PUT: typeof import('../../app/api/sales-settings/[brand]/route').PUT;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/sales-settings/[brand]/route');
  GET = mod.GET;
  PUT = mod.PUT;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

describe('GET /api/sales-settings/[brand]', () => {
  it('returns emptySalesSettings with source "default" on first visit', async () => {
    const res = await GET(
      req('/api/sales-settings/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('default');
    expect(body.settings.brand).toBe('cogmap');
    expect(body.settings.products).toEqual([]);
  });
});

describe('PUT then GET /api/sales-settings/[brand] — real round trip', () => {
  // This closes the exact gap disclosed when the feature first shipped: the
  // sandbox had no MONGODB_URI, so the real Mongo upsert-then-read-back path
  // was never actually exercised, only unit-tested at the sanitizer level.
  it('persists a submitted settings document and reads it back correctly', async () => {
    const payload = {
      companyName: 'Integration Test Co',
      mainIndustry: 'Sports Tech',
      customerTypes: ['sports_clubs', 'federations'],
      products: [
        {
          id: 'p1',
          name: 'Cognitive Assessment',
          description: 'Player evaluation suite',
          whyTheyBuy: 'Improves squad selection',
          typicalBuyer: ['coach'],
          typicalBuyerOther: '',
          customerSize: ['medium'],
          pricingModels: ['per_user'],
          pricing: { perUserPrice: '25', perUserMinimum: 10 },
          revenuePredictability: 'predictable',
        },
      ],
      dealSize: { small: '1000', medium: 5000, large: 15000 },
    };

    const putRes = await PUT(
      req('/api/sales-settings/cogmap?tenantId=default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.source).toBe('mongodb');
    // Sanitizer coerces numeric-string prices to real numbers on write.
    expect(putBody.settings.products[0].pricing.perUserPrice).toBe(25);
    expect(putBody.settings.dealSize.small).toBe(1000);

    const getRes = await GET(
      req('/api/sales-settings/cogmap?tenantId=default'),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.source).toBe('mongodb');
    expect(getBody.settings.companyName).toBe('Integration Test Co');
    expect(getBody.settings.products[0].name).toBe('Cognitive Assessment');
    expect(getBody.settings.products[0].pricing.perUserPrice).toBe(25);
    expect(getBody.settings.customerTypes).toEqual(['sports_clubs', 'federations']);
  });

  it('does not require an x-api-key header (the 2.4.21 auth fix)', async () => {
    // No x-api-key header sent at all, matching exactly what the browser
    // Save button sends — this is the real regression this route already
    // shipped a fix for; guard against it silently coming back.
    const res = await PUT(
      req('/api/sales-settings/seyu?tenantId=default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: 'No Auth Header Co' }),
      }),
      { params: Promise.resolve({ brand: 'seyu' }) }
    );
    expect(res.status).toBe(200);
  });
});
