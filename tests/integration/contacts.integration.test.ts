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

  it('exports Pipeline Stage and landing-page Consents in GET /api/contacts?format=csv', async () => {
    const postRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Landing Visitor FC',
        url: 'https://landing-visitor-fc.example.com',
        country: 'GB',
        kanbanColumn: 'ENGAGED',
        ice: { impact: 7, confidence: 8, ease: 8 },
        contacts: [
          {
            name: 'Visitor Jane',
            email: 'visitor@landing-fc.example.com',
            isDecisionMaker: true,
            consents: [{ key: 'promo_opt_in', label: 'Marketing Offers Opt-In', value: true }],
          },
        ],
      }),
    }));
    expect(postRes.status).toBe(201);

    const csvRes = await contactsGET(req('/api/contacts?brand=cogmap&q=Visitor%20Jane&format=csv'));
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain('"Pipeline Stage"');
    expect(csvText).toContain('"Consents"');
    expect(csvText).toContain('"Consent: Marketing Offers Opt-In"');
    expect(csvText).toContain('"ENGAGED"');
    expect(csvText).toContain('"Marketing Offers Opt-In: Yes"');
  });

  it('rejects a request with no valid auth', async () => {
    const res = await contactsGET(new (await import('next/server')).NextRequest('http://localhost/api/contacts?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('exports each landing-form visitor\'s own consent answers, through the real submit route', async () => {
    const { POST: submitForm } = await import('../../app/api/forms/[brand]/submit/route');
    const send = async (firstName: string, email: string, value: string, extra: Record<string, unknown> = {}) => {
      const res = await submitForm(
        req('/api/forms/cogmap/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName,
            lastName: 'Walker',
            contactEmail: email,
            entityName: 'Shared Walkers Club',
            websiteUrl: 'https://walkers.example.com',
            country: 'GB',
            campaign: 'spring',
            consents: [{ key: 'f_news', label: 'News by email', value }],
            ...extra,
          }),
        }),
        { params: Promise.resolve({ brand: 'cogmap' }) }
      );
      expect(res.status).toBe(201);
      return res.json();
    };

    const first = await send('Anna', 'anna@walkers.example.com', 'Yes', { contactPhone: '+44 7700 900123' });
    const second = await send('Ben', 'ben@walkers.example.com', 'Yes');
    const third = await send('Anna', 'anna@walkers.example.com', 'No');
    expect([second.leadId, third.leadId]).toEqual([first.leadId, first.leadId]);

    const res = await contactsGET(req('/api/contacts?brand=cogmap&q=Walker&format=csv'));
    expect(res.status).toBe(200);
    const { parseCsvOrTsv } = await import('../../lib/crm-lead-exchange');
    const { headers, rows } = parseCsvOrTsv(await res.text());
    const answersByEmail = rows
      .map((r) => [r[headers.indexOf('Primary Email')], r[headers.indexOf('Consent: News by email')]])
      .sort();
    expect(answersByEmail).toEqual([
      ['anna@walkers.example.com', 'No'],
      ['ben@walkers.example.com', 'Yes'],
    ]);
  });
});
