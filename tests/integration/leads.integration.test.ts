import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/leads/route').GET;
let POST: typeof import('../../app/api/leads/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/leads/route');
  GET = mod.GET;
  POST = mod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

describe('GET /api/leads', () => {
  it('returns an empty list against a fresh database', async () => {
    const res = await GET(req('/api/leads?brand=cogmap'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.leads).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('POST /api/leads', () => {
  it('creates a lead and it is retrievable via GET', async () => {
    const payload = {
      entity_name: 'Integration Test FC',
      url: 'https://integration-test-fc.example.com',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 8, confidence: 7, ease: 6 },
      contacts: [{ name: 'Ops Contact', email: 'ops@integration-test-fc.example.com', isDecisionMaker: true }],
    };

    const postRes = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(postRes.status).toBe(201);

    const getRes = await GET(req('/api/leads?brand=cogmap'));
    const getBody = await getRes.json();
    expect(getBody.total).toBe(1);
    expect(getBody.leads[0].entity_name).toBe('Integration Test FC');
    expect(getBody.leads[0].contacts).toEqual([
      { name: 'Ops Contact', title: '', email: 'ops@integration-test-fc.example.com', phone: '', linkedin: '', role: '', isDecisionMaker: true },
    ]);
  });

  it('ignores legacy decision_maker_*/contact_phone fields on create rather than storing them (hard cutover, issue #45)', async () => {
    const payload = {
      entity_name: 'Legacy Field FC',
      url: 'https://legacy-field-fc.example.com',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      decision_maker_name: 'Legacy Name',
      decision_maker_contact: 'legacy@legacy-field-fc.example.com',
      contact_phone: '+1-555-000-0000',
    };

    const postRes = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    expect(postBody.lead.decision_maker_name).toBeUndefined();
    expect(postBody.lead.decision_maker_contact).toBeUndefined();
    expect(postBody.lead.contact_phone).toBeUndefined();
    expect(postBody.lead.contacts).toEqual([]);
  });

  it('rejects a payload that fails validation (bad country code)', async () => {
    const payload = {
      entity_name: 'Bad Country FC',
      url: 'https://bad-country-fc.example.com',
      country: 'USA', // must be 2-letter ISO
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
    };

    const res = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(400);
  });

  it('deduplicates a second lead sharing the same fingerprint (url + entity_name + region)', async () => {
    const payload = {
      entity_name: 'Dedup Test FC',
      url: 'https://dedup-test-fc.example.com',
      region: 'US',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
    };

    const first = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(first.status).toBe(201);

    const second = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error).toBe('Duplicate lead detected');
  });
});
