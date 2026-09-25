import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest, TEST_API_KEY } from './helpers/api-request';
import { NextRequest } from 'next/server';

let mongod: MongoMemoryServer;
let backfillPOST: typeof import('../../app/api/admin/products-backfill/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  backfillPOST = (await import('../../app/api/admin/products-backfill/route')).POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

function apiReq(body: unknown) {
  return buildApiRequest('/api/admin/products-backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/products-backfill (issue 215)', () => {
  it('401s without a valid x-api-key', async () => {
    const res = await backfillPOST(new NextRequest('http://localhost/api/admin/products-backfill', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('dry-run (apply: false, default) reports what would change without writing', async () => {
    const database = await db();
    await database.collection('company_settings').insertOne({
      brand: 'cogmap', tenantId: 'backfill-test',
      products: [{ id: 'x', name: 'Widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
    });

    const res = await backfillPOST(apiReq({ brand: 'cogmap', tenantId: 'backfill-test' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apply).toBe(false);
    expect(body.byBrand.cogmap.created).toBe(1);

    const written = await database.collection('products').countDocuments({ brand: 'cogmap', tenantId: 'backfill-test' });
    expect(written).toBe(0);
  });

  it('apply: true actually writes the catalog rows', async () => {
    const res = await backfillPOST(apiReq({ brand: 'cogmap', tenantId: 'backfill-test', apply: true }));
    const body = await res.json();
    expect(body.apply).toBe(true);
    expect(body.byBrand.cogmap.created).toBe(1);

    const database = await db();
    const written = await database.collection('products').countDocuments({ brand: 'cogmap', tenantId: 'backfill-test' });
    expect(written).toBe(1);
  });

  it('an invalid brand returns 400', async () => {
    const res = await backfillPOST(apiReq({ brand: 'not-a-real-brand' }));
    expect(res.status).toBe(400);
  });
});
