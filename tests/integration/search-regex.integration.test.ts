import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #106: q was interpolated into $regex unescaped. A query containing
// regex metacharacters previously matched far more (or less) than the
// literal text a user typed — this is the regression guard.

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/search/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  GET = (await import('../../app/api/search/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function seedLead(entityName: string, tenantId: string = 'default'): Promise<void> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  await db.collection('leads').insertOne({
    entity_name: entityName,
    tenantId,
    kanbanColumn: 'DISCOVERED',
  });
}

function req(url: string) {
  return buildApiRequest(url);
}

describe('GET /api/search — regex metacharacters treated as literal text', () => {
  it('a literal "." in the query does not match unrelated names (would match any single character as an unescaped regex)', async () => {
    await seedLead('Acme.Corp');
    await seedLead('AcmeXCorp');

    const res = await GET(req('/api/search?q=Acme.Corp&brand=cogmap'));
    const body = await res.json();

    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Acme.Corp');
    expect(names).not.toContain('AcmeXCorp');
  });

  it('a query containing regex-special characters does not throw or hang (ReDoS-shaped input)', async () => {
    const res = await GET(req(`/api/search?q=${encodeURIComponent('(a+)+$')}&brand=cogmap`));
    expect(res.status).toBe(200);
  });
});

// Regression guard for a real, confirmed-live bug found in a 2026-07-27
// documentation audit: buildSearchFilter() built its query as
// `{ ...tenantFilter(tenantId), $or: [...] }` — for the 'default' tenant,
// tenantFilter() itself returns an object whose own top-level key is $or, so
// the spread silently discarded tenant scoping entirely (later key wins).
// GET /api/search returned leads from every tenant, not just the caller's.
// Same root cause, independently discovered, as the tryFindLead() fix in
// app/api/leads/[id]/route.ts one commit earlier — that fix was not checked
// against this route at the time.
describe('GET /api/search — tenant isolation', () => {
  it('does not return a matching lead that belongs to a different tenant', async () => {
    await seedLead('Isolation Test Corp', 'default');
    await seedLead('Isolation Test Corp Other Tenant', 'some-other-tenant');

    const res = await GET(req('/api/search?q=Isolation+Test+Corp&brand=cogmap&tenantId=default'));
    const body = await res.json();

    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Isolation Test Corp');
    expect(names).not.toContain('Isolation Test Corp Other Tenant');
  });
});
