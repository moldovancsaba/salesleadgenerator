import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #226: these routes served or changed brand business data with no
// credential at all. Each is checked for the three outcomes that matter: no
// credential is refused, another brand's scoped key is refused, and the
// legacy key still works.

let mongod: MongoMemoryServer;
let seyuKey: string;

let salesSettings: typeof import('../../app/api/sales-settings/[brand]/route');
let products: typeof import('../../app/api/products/[brand]/route');
let product: typeof import('../../app/api/products/[brand]/[productId]/route');
let outcomeLogs: typeof import('../../app/api/outcome-logs/route');
let outreachLogs: typeof import('../../app/api/outreach-logs/route');

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  return (await clientPromise).db();
}

beforeAll(async () => {
  mongod = await startTestMongo();
  salesSettings = await import('../../app/api/sales-settings/[brand]/route');
  products = await import('../../app/api/products/[brand]/route');
  product = await import('../../app/api/products/[brand]/[productId]/route');
  outcomeLogs = await import('../../app/api/outcome-logs/route');
  outreachLogs = await import('../../app/api/outreach-logs/route');
  const { createApiKey } = await import('../../app/lib/api-key-store');
  seyuKey = (await createApiKey(await db(), { name: 'seyu-only', brand: 'seyu', scopes: ['read-write'] }, 'test')).rawKey;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function anonymous(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

function withSeyuKey(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-api-key': seyuKey } });
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const cogmap = { params: Promise.resolve({ brand: 'cogmap' }) };

describe('sales settings (issue 226)', () => {
  it('GET refuses a request with no credential', async () => {
    const res = await salesSettings.GET(anonymous('/api/sales-settings/cogmap'), cogmap);
    expect(res.status).toBe(401);
  });

  it('GET refuses another brand\'s scoped key', async () => {
    const res = await salesSettings.GET(withSeyuKey('/api/sales-settings/cogmap'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(403);
  });

  it('PUT with no credential is refused and writes nothing', async () => {
    const res = await salesSettings.PUT(
      anonymous('/api/sales-settings/cogmap?tenantId=auth-test', json('PUT', { companyName: 'Hijacked' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(res.status).toBe(401);
    expect(await (await db()).collection('company_settings').findOne({ brand: 'cogmap', tenantId: 'auth-test' })).toBeNull();
  });

  it('PUT with another brand\'s scoped key is refused and writes nothing', async () => {
    const res = await salesSettings.PUT(
      withSeyuKey('/api/sales-settings/cogmap?tenantId=auth-test', json('PUT', { companyName: 'Hijacked' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(res.status).toBe(403);
    expect(await (await db()).collection('company_settings').findOne({ brand: 'cogmap', tenantId: 'auth-test' })).toBeNull();
  });

  it('GET and PUT still work with the legacy key', async () => {
    const put = await salesSettings.PUT(
      buildApiRequest('/api/sales-settings/cogmap?tenantId=auth-test', json('PUT', { companyName: 'Allowed Co' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(put.status).toBe(200);
    const get = await salesSettings.GET(buildApiRequest('/api/sales-settings/cogmap?tenantId=auth-test'), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(get.status).toBe(200);
    expect((await get.json()).settings.companyName).toBe('Allowed Co');
  });
});

describe('product catalog (issue 226)', () => {
  const valid = { name: 'Auth Test Product', unitPrice: 100, pricingModel: 'one_time' };

  it('GET and POST refuse a request with no credential', async () => {
    expect((await products.GET(anonymous('/api/products/cogmap'), { params: Promise.resolve({ brand: 'cogmap' }) })).status).toBe(401);
    const post = await products.POST(anonymous('/api/products/cogmap?tenantId=auth-test', json('POST', valid)), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(post.status).toBe(401);
    expect(await (await db()).collection('products').countDocuments({ tenantId: 'auth-test' })).toBe(0);
  });

  it('POST refuses another brand\'s scoped key', async () => {
    const res = await products.POST(withSeyuKey('/api/products/cogmap?tenantId=auth-test', json('POST', valid)), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(403);
  });

  it('PATCH and DELETE refuse no credential and another brand\'s key, and leave the product unchanged', async () => {
    const created = await products.POST(buildApiRequest('/api/products/cogmap?tenantId=auth-test', json('POST', valid)), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(created.status).toBe(201);
    const { product: p } = await created.json();
    const idParams = () => ({ params: Promise.resolve({ brand: 'cogmap', productId: p.id }) });
    const url = `/api/products/cogmap/${p.id}?tenantId=auth-test`;

    expect((await product.PATCH(anonymous(url, json('PATCH', { unitPrice: 1 })), idParams())).status).toBe(401);
    expect((await product.PATCH(withSeyuKey(url, json('PATCH', { unitPrice: 1 })), idParams())).status).toBe(403);
    expect((await product.DELETE(anonymous(url, { method: 'DELETE' }), idParams())).status).toBe(401);
    expect((await product.DELETE(withSeyuKey(url, { method: 'DELETE' }), idParams())).status).toBe(403);

    const stored = await (await db()).collection('products').findOne({ brand: 'cogmap', tenantId: 'auth-test', id: p.id });
    expect(stored?.unitPrice).toBe(100);
  });
});

describe('outcome and outreach log reads (issue 226)', () => {
  it('GET /api/outcome-logs refuses no credential and works with the legacy key', async () => {
    await (await db()).collection('outcomelogs').insertOne({ leadId: 'auth-test-lead', action: 'COLUMN_MOVE', createdAt: new Date() });
    expect((await outcomeLogs.GET(anonymous('/api/outcome-logs'))).status).toBe(401);
    const ok = await outcomeLogs.GET(buildApiRequest('/api/outcome-logs?leadId=auth-test-lead'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).logs).toHaveLength(1);
  });

  it('GET /api/outreach-logs refuses no credential and works with the legacy key', async () => {
    expect((await outreachLogs.GET(anonymous('/api/outreach-logs'))).status).toBe(401);
    expect((await outreachLogs.GET(buildApiRequest('/api/outreach-logs'))).status).toBe(200);
  });
});
