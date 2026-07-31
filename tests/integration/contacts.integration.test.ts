import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let contactsGET: typeof import('../../app/api/contacts/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  const contactsMod = await import('../../app/api/contacts/route');
  contactsGET = contactsMod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: Parameters<typeof buildApiRequest>[1]) {
  return buildApiRequest(url, init);
}

async function createLead(brand: 'cogmap' | 'seyu', entityName: string, contacts: any[]) {
  const res = await leadsPOST(req(`/api/leads?brand=${brand}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts,
    }),
  }));
  expect(res.status).toBe(201);
}

describe('GET /api/contacts', () => {
  it('aggregates contacts across leads within a brand, grouped by contactKey', async () => {
    await createLead('cogmap', 'Alpha FC', [{ name: 'Jane Doe', phone: '5551234567', isDecisionMaker: true }]);
    await createLead('cogmap', 'Alpha Agency', [{ name: 'Jane Doe', phone: '5551234567' }]);
    await createLead('cogmap', 'Beta FC', [{ name: 'Bob Smith', email: 'bob@beta.example.com' }]);

    const res = await contactsGET(req('/api/contacts?brand=cogmap'));
    expect(res.status).toBe(200);
    const body = await res.json();

    const jane = body.contacts.find((c: any) => c.name === 'Jane Doe');
    expect(jane).toBeDefined();
    expect(jane.leads).toHaveLength(2);
    expect(jane.isDecisionMaker).toBe(true);

    const bob = body.contacts.find((c: any) => c.name === 'Bob Smith');
    expect(bob).toBeDefined();
    expect(bob.leads).toHaveLength(1);
  });

  it('filters by the q param, case-insensitively, against contact name', async () => {
    await createLead('cogmap', 'Gamma FC', [{ name: 'Search Target', email: 'target@gamma.example.com' }]);

    const res = await contactsGET(req('/api/contacts?brand=cogmap&q=search'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts.every((c: any) => /search/i.test(c.name))).toBe(true);
    expect(body.contacts.some((c: any) => c.name === 'Search Target')).toBe(true);
  });

  it('does not leak contacts from a different brand', async () => {
    await createLead('seyu', 'Seyu-Only Org', [{ name: 'Seyu Only Contact', email: 'only@seyu.example.com' }]);

    const res = await contactsGET(req('/api/contacts?brand=cogmap'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts.some((c: any) => c.name === 'Seyu Only Contact')).toBe(false);
  });

  it('rejects a request with no valid auth', async () => {
    const res = await contactsGET(new (await import('next/server')).NextRequest('http://localhost/api/contacts?brand=cogmap'));
    expect(res.status).toBe(401);
  });
});
