import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #222: the read-only country check scans a whole brand server-side
// and returns counts plus at most 20 rows for one reason at a time.

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/admin/data-hygiene/country/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  GET = (await import('../../app/api/admin/data-hygiene/country/route')).GET;
  const clientPromise = (await import('../../lib/mongodb')).default;
  const db = (await clientPromise).db();
  const lead = (entity_name: string, country: string, address: string) => ({ entity_name, country, address, tenantId: 'default', createdAt: new Date() });
  const mismatches = Array.from({ length: 25 }, (_, i) => lead(`Mismatch Club ${i}`, 'DE', `Leicester, United Kingdom`));
  await db.collection('seyu_leads').insertMany([
    ...mismatches,
    lead('Bayern', 'DE', 'München, Germany'),
    lead('Echo Rotterdam', 'NL', 'Rotterdam, NL'),
    lead('Broken Code', 'XX', 'Paris, France'),
  ]);
  await db.collection('leads').insertOne(lead('CogMap Only', 'DE', 'Paris, France'));
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

describe('GET /api/admin/data-hygiene/country (issue 222)', () => {
  it('refuses a request with no API key', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/data-hygiene/country?brand=seyu'));
    expect(res.status).toBe(401);
  });

  it('requires an explicit, valid brand', async () => {
    expect((await GET(buildApiRequest('/api/admin/data-hygiene/country'))).status).toBe(400);
    expect((await GET(buildApiRequest('/api/admin/data-hygiene/country?brand=nope'))).status).toBe(400);
  });

  it('counts every lead of the brand by reason and caps rows at 20', async () => {
    const res = await GET(buildApiRequest('/api/admin/data-hygiene/country?brand=seyu'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(28);
    expect(body.counts).toMatchObject({ mismatch: 25, consistent: 1, 'echo-only': 1, 'invalid-code': 1 });
    expect(body.anomalies).toBe(26);
    expect(body.rows).toHaveLength(20);
    expect(body.hasMore).toBe(true);
    expect(body.rows[0]).toMatchObject({ country: 'DE', suggestedCountry: 'GB' });
    expect(Object.keys(body.rows[0]).sort()).toEqual(['_id', 'country', 'entity_name', 'evidence', 'region', 'suggestedCountry']);
  });

  it('pages a reason with offset and filters by reason', async () => {
    const page2 = await (await GET(buildApiRequest('/api/admin/data-hygiene/country?brand=seyu&offset=20'))).json();
    expect(page2.rows).toHaveLength(5);
    expect(page2.hasMore).toBe(false);
    const invalid = await (await GET(buildApiRequest('/api/admin/data-hygiene/country?brand=seyu&reason=invalid-code'))).json();
    expect(invalid.rows.map((r: any) => r.entity_name)).toEqual(['Broken Code']);
  });

  it('never mixes brands', async () => {
    const body = await (await GET(buildApiRequest('/api/admin/data-hygiene/country?brand=cogmap'))).json();
    expect(body.total).toBe(1);
    expect(body.rows.map((r: any) => r.entity_name)).toEqual(['CogMap Only']);
  });
});

describe('GET /api/admin/data-hygiene ?brand= (issue 222 review)', () => {
  it('reports only the requested brand, and every brand without one', async () => {
    const { GET: hygieneGET } = await import('../../app/api/admin/data-hygiene/route');
    const one = await (await hygieneGET(buildApiRequest('/api/admin/data-hygiene?brand=seyu'))).json();
    expect(one.brands.map((b: any) => b.brand)).toEqual(['seyu']);
    const all = await (await hygieneGET(buildApiRequest('/api/admin/data-hygiene'))).json();
    expect(all.brands.length).toBeGreaterThan(1);
  });
});
