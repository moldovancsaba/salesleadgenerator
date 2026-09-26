import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let listGET: typeof import('../../app/api/products/[brand]/route').GET;
let listPOST: typeof import('../../app/api/products/[brand]/route').POST;
let itemPATCH: typeof import('../../app/api/products/[brand]/[productId]/route').PATCH;
let itemDELETE: typeof import('../../app/api/products/[brand]/[productId]/route').DELETE;

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/products/[brand]/route');
  listGET = listMod.GET;
  listPOST = listMod.POST;
  const itemMod = await import('../../app/api/products/[brand]/[productId]/route');
  itemPATCH = itemMod.PATCH;
  itemDELETE = itemMod.DELETE;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

// Issue #226: these routes now require a credential; the legacy key
// stands in for the browser session the real pages use.
function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

function jsonBody(body: unknown) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('Products catalog CRUD (issue 215)', () => {
  it('POST creates a product, GET lists it', async () => {
    const res = await listPOST(
      req('/api/products/cogmap?tenantId=crud-test', jsonBody({ name: 'Season Sponsorship', unitPrice: 45000, currency: 'USD', pricingModel: 'annual_subscription' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(res.status).toBe(201);
    const created = (await res.json()).product;
    expect(created.name).toBe('Season Sponsorship');
    expect(created.active).toBe(true);

    const listRes = await listGET(req('/api/products/cogmap?tenantId=crud-test'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const list = await listRes.json();
    expect(list.products.some((p: any) => p.id === created.id)).toBe(true);
  });

  it('POST rejects a payload with no usable name/unitPrice/pricingModel', async () => {
    const res = await listPOST(
      req('/api/products/cogmap?tenantId=crud-test', jsonBody({ name: '', unitPrice: 0 })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    );
    expect(res.status).toBe(400);
  });

  it('PATCH updates an existing product', async () => {
    const created = (await (await listPOST(
      req('/api/products/cogmap?tenantId=crud-test', jsonBody({ name: 'To Edit', unitPrice: 100, pricingModel: 'one_time' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    )).json()).product;

    const res = await itemPATCH(
      req(`/api/products/cogmap/${created.id}?tenantId=crud-test`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitPrice: 250 }) }),
      { params: Promise.resolve({ brand: 'cogmap', productId: created.id }) }
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()).product;
    expect(updated.unitPrice).toBe(250);
    expect(updated.name).toBe('To Edit'); // untouched fields preserved on a partial PATCH
  });

  it('PATCH 404s for a productId that does not exist', async () => {
    const res = await itemPATCH(
      req('/api/products/cogmap/nonexistent?tenantId=crud-test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitPrice: 250 }) }),
      { params: Promise.resolve({ brand: 'cogmap', productId: 'nonexistent' }) }
    );
    expect(res.status).toBe(404);
  });

  it('DELETE removes a product with no referencing deals', async () => {
    const created = (await (await listPOST(
      req('/api/products/cogmap?tenantId=crud-test', jsonBody({ name: 'To Delete', unitPrice: 100, pricingModel: 'one_time' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    )).json()).product;

    const res = await itemDELETE(
      req(`/api/products/cogmap/${created.id}?tenantId=crud-test`, { method: 'DELETE' }),
      { params: Promise.resolve({ brand: 'cogmap', productId: created.id }) }
    );
    expect(res.status).toBe(204);
  });

  it('DELETE is blocked with 409 when a lead references the product via deals[].lineItems', async () => {
    const created = (await (await listPOST(
      req('/api/products/cogmap?tenantId=crud-test', jsonBody({ name: 'Referenced Product', unitPrice: 100, pricingModel: 'one_time' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    )).json()).product;

    const database = await db();
    await database.collection('leads').insertOne({
      entity_name: 'Referencing Lead',
      tenantId: 'crud-test',
      kanbanColumn: 'QUALIFIED',
      deals: [{ id: 'deal-1', value: 100, currency: 'USD', source: 'catalog_line_items', lineItems: [{ productId: created.id, quantity: 1, unitPriceOverride: 100 }] }],
      contacts: [], tags: [], checklist: [],
      createdAt: new Date(), updatedAt: new Date().toISOString(),
    });

    const res = await itemDELETE(
      req(`/api/products/cogmap/${created.id}?tenantId=crud-test`, { method: 'DELETE' }),
      { params: Promise.resolve({ brand: 'cogmap', productId: created.id }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.dealIds).toHaveLength(1);
  });

  it('enforces tenant isolation — a productId in tenant A never resolves for tenant B', async () => {
    const created = (await (await listPOST(
      req('/api/products/cogmap?tenantId=tenant-a', jsonBody({ name: 'Tenant A Product', unitPrice: 100, pricingModel: 'one_time' })),
      { params: Promise.resolve({ brand: 'cogmap' }) }
    )).json()).product;

    const listB = await listGET(req('/api/products/cogmap?tenantId=tenant-b'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const bodyB = await listB.json();
    expect(bodyB.products.find((p: any) => p.id === created.id)).toBeUndefined();

    const patchB = await itemPATCH(
      req(`/api/products/cogmap/${created.id}?tenantId=tenant-b`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitPrice: 1 }) }),
      { params: Promise.resolve({ brand: 'cogmap', productId: created.id }) }
    );
    expect(patchB.status).toBe(404);
  });
});
