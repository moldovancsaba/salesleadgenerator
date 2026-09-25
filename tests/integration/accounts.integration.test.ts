import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let accountsListGET: typeof import('../../app/api/accounts/route').GET;
let accountsDetailGET: typeof import('../../app/api/accounts/[parentOrgId]/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  accountsListGET = (await import('../../app/api/accounts/route')).GET;
  accountsDetailGET = (await import('../../app/api/accounts/[parentOrgId]/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedLead(collection: string, overrides: Record<string, unknown> = {}) {
  const database = await db();
  const result = await database.collection(collection).insertOne({
    entity_name: 'Acme FC',
    url: 'https://acme-fc.example.com',
    country: 'US',
    region: 'US',
    tenantId: 'default',
    kanbanColumn: 'QUALIFIED',
    contacts: [],
    tags: [],
    deals: [],
    checklist: [],
    createdAt: new Date(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });
  return result.insertedId.toString();
}

describe('GET /api/accounts', () => {
  it('groups leads by parentOrgId and returns a summed rollup', async () => {
    await seedLead('leads', {
      entity_name: 'Acme FC — Football',
      parentOrgId: 'acme-list',
      parentOrgName: 'Acme Holdings',
      kanbanColumn: 'QUALIFIED',
      ticketSizeEstimate: { method: 'tier_band', expected: 5000, currency: 'USD', computedAt: new Date().toISOString() },
    });
    await seedLead('leads', {
      entity_name: 'Acme FC — Basketball',
      parentOrgId: 'acme-list',
      kanbanColumn: 'WON',
      actualDealValueUsd: 10000,
    });

    const res = await accountsListGET(buildApiRequest('/api/accounts?brand=cogmap&tenantId=default'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const account = body.accounts.find((a: any) => a.parentOrgId === 'acme-list');
    expect(account).toBeTruthy();
    expect(account.leadCount).toBe(2);
    expect(account.parentOrgName).toBe('Acme Holdings');
    expect(account.pipelineValueUsd).toBe(5000);
    expect(account.wonValueUsd).toBe(10000);
  });

  it('never groups a lead with no parentOrgId set', async () => {
    await seedLead('leads', { entity_name: 'No Parent Co', parentOrgId: undefined });
    const res = await accountsListGET(buildApiRequest('/api/accounts?brand=cogmap&tenantId=default'));
    const body = await res.json();
    const noParentGroup = body.accounts.find((a: any) => !a.parentOrgId);
    expect(noParentGroup).toBeUndefined();
  });

  it('excludes a lead whose ticketSizeEstimate currency does not match the brand currency from the sum (issue 209 §15)', async () => {
    await seedLead('seyu_leads', {
      entity_name: 'Mismatch Co',
      parentOrgId: 'mismatch-org',
      kanbanColumn: 'QUALIFIED',
      // seyu's fallback brand config is EUR — a USD estimate must be excluded.
      ticketSizeEstimate: { method: 'tier_band', expected: 7777, currency: 'USD', computedAt: new Date().toISOString() },
    });
    const res = await accountsListGET(buildApiRequest('/api/accounts?brand=seyu&tenantId=default'));
    const body = await res.json();
    const account = body.accounts.find((a: any) => a.parentOrgId === 'mismatch-org');
    expect(account.pipelineValueUsd).toBe(0);
  });

  it('enforces tenant isolation — a lead in tenant A never appears in tenant B\'s rollup', async () => {
    await seedLead('leads', { entity_name: 'Tenant A Co', parentOrgId: 'tenant-isolation-org', tenantId: 'tenant-a' });
    const resB = await accountsListGET(buildApiRequest('/api/accounts?brand=cogmap&tenantId=tenant-b'));
    const bodyB = await resB.json();
    expect(bodyB.accounts.find((a: any) => a.parentOrgId === 'tenant-isolation-org')).toBeUndefined();

    const resA = await accountsListGET(buildApiRequest('/api/accounts?brand=cogmap&tenantId=tenant-a'));
    const bodyA = await resA.json();
    expect(bodyA.accounts.find((a: any) => a.parentOrgId === 'tenant-isolation-org')).toBeTruthy();
  });

  it('401s without a valid credential', async () => {
    const res = await accountsListGET(new (await import('next/server')).NextRequest('http://localhost/api/accounts?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('discloses truncation via totalAvailable/truncated fields', async () => {
    const res = await accountsListGET(buildApiRequest('/api/accounts?brand=cogmap&tenantId=default'));
    const body = await res.json();
    expect(typeof body.totalAvailable).toBe('number');
    expect(typeof body.truncated).toBe('boolean');
  });
});

describe('GET /api/accounts/[parentOrgId]', () => {
  it('returns every lead sharing the exact parentOrgId within the brand+tenant', async () => {
    await seedLead('leads', { entity_name: 'Detail Co — Unit A', parentOrgId: 'detail-org', tenantId: 'detail-tenant' });
    await seedLead('leads', { entity_name: 'Detail Co — Unit B', parentOrgId: 'detail-org', tenantId: 'detail-tenant' });
    await seedLead('leads', { entity_name: 'Unrelated Co', parentOrgId: 'other-org', tenantId: 'detail-tenant' });

    const res = await accountsDetailGET(
      buildApiRequest('/api/accounts/detail-org?brand=cogmap&tenantId=detail-tenant'),
      { params: Promise.resolve({ parentOrgId: 'detail-org' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.leads).toHaveLength(2);
    expect(body.account.leads.map((l: any) => l.entity_name).sort()).toEqual(['Detail Co — Unit A', 'Detail Co — Unit B']);
  });

  it('404s for a parentOrgId matching zero leads', async () => {
    const res = await accountsDetailGET(
      buildApiRequest('/api/accounts/nonexistent-org-id?brand=cogmap&tenantId=default'),
      { params: Promise.resolve({ parentOrgId: 'nonexistent-org-id' }) }
    );
    expect(res.status).toBe(404);
  });

  it('enforces tenant isolation on the detail route too', async () => {
    await seedLead('leads', { entity_name: 'Iso Co', parentOrgId: 'detail-iso-org', tenantId: 'iso-tenant-a' });

    const resWrongTenant = await accountsDetailGET(
      buildApiRequest('/api/accounts/detail-iso-org?brand=cogmap&tenantId=iso-tenant-b'),
      { params: Promise.resolve({ parentOrgId: 'detail-iso-org' }) }
    );
    expect(resWrongTenant.status).toBe(404);

    const resRightTenant = await accountsDetailGET(
      buildApiRequest('/api/accounts/detail-iso-org?brand=cogmap&tenantId=iso-tenant-a'),
      { params: Promise.resolve({ parentOrgId: 'detail-iso-org' }) }
    );
    expect(resRightTenant.status).toBe(200);
  });

  it('401s without a valid credential', async () => {
    const res = await accountsDetailGET(
      new (await import('next/server')).NextRequest('http://localhost/api/accounts/some-org?brand=cogmap'),
      { params: Promise.resolve({ parentOrgId: 'some-org' }) }
    );
    expect(res.status).toBe(401);
  });
});
