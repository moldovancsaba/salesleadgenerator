import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import type { NextRequest } from 'next/server';

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

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
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

// Issue #127 — app/components/AddLeadModal.tsx is the first real UI caller
// of this route (previously only the research agent posted here). It always
// sends a full contact plus lib/create-lead-defaults.ts's
// MANUAL_LEAD_DEFAULT_ICE (impact 5, confidence 5 — ease is independently
// recomputed server-side by computeEase() from the contact/address fields,
// not read from the posted ice.ease) and source: 'manual'. This exercises
// that exact payload shape end-to-end, including the requireBrandAccessApi
// auth swap (this test's x-api-key path stays green, matching what
// docs/ARCHITECTURE.md documents as the backward-compatible machine-caller
// path) and confirms a manually-added lead lands in DISCOVERED rather than
// being auto-qualified.
describe('POST /api/leads — manual Add Lead flow (issue #127)', () => {
  it('creates a manual lead with a full contact, lands in DISCOVERED, and persists source: manual', async () => {
    const payload = {
      entity_name: 'Manually Added FC',
      url: 'https://manually-added-fc.example.com',
      country: 'US',
      region: 'US',
      kanbanColumn: 'DISCOVERED',
      address: '',
      general_contact: '',
      size: '',
      industry: 'Football',
      sport_or_sector: 'Football',
      level_league: '',
      value_proposition: '',
      notes: '',
      tags: [],
      contacts: [{ name: 'Jordan Smith', email: 'jordan@manually-added-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
      ice: { impact: 5, confidence: 5, ease: 5 },
      source: 'manual',
    };

    const res = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('DISCOVERED');
    expect(body.lead.source).toBe('manual');
    expect(body.lead.contacts).toHaveLength(1);
    // Only the fields this test's own payload controls — normalize-lead.ts
    // strips phone formatting and a separate, pre-existing background
    // enrichment step (unrelated to issue #127) adds fields like
    // department/seniorityTier/lastVerifiedAt asynchronously, so a full
    // deep-equal here would be asserting on someone else's behavior.
    expect(body.lead.contacts[0]).toMatchObject({
      name: 'Jordan Smith',
      email: 'jordan@manually-added-fc.example.com',
      isDecisionMaker: true,
    });

    const getRes = await GET(req('/api/leads?brand=cogmap'));
    const getBody = await getRes.json();
    const created = getBody.leads.find((l: any) => l.entity_name === 'Manually Added FC');
    expect(created.kanbanColumn).toBe('DISCOVERED');
  });

  it('still enforces the duplicate-fingerprint check for a second manual submission of the same entity', async () => {
    const payload = {
      entity_name: 'Manual Dup FC',
      url: 'https://manual-dup-fc.example.com',
      country: 'US',
      region: 'US',
      kanbanColumn: 'DISCOVERED',
      contacts: [{ name: 'Alex Rivera', email: 'alex@manual-dup-fc.example.com', phone: '+1 555 0101', isDecisionMaker: true }],
      ice: { impact: 5, confidence: 5, ease: 5 },
      source: 'manual',
    };

    const first = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(first.status).toBe(201);

    const second = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(second.status).toBe(409);
  });
});
