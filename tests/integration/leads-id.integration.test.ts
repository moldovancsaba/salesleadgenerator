import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import type { NextRequest } from 'next/server';

let mongod: MongoMemoryServer;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let idGET: typeof import('../../app/api/leads/[id]/route').GET;
let idPUT: typeof import('../../app/api/leads/[id]/route').PUT;
let idDELETE: typeof import('../../app/api/leads/[id]/route').DELETE;

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/leads/route');
  leadsGET = listMod.GET;
  leadsPOST = listMod.POST;
  const idMod = await import('../../app/api/leads/[id]/route');
  idGET = idMod.GET;
  idPUT = idMod.PUT;
  idDELETE = idMod.DELETE;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

async function createLead(entityName: string, ice = { impact: 8, confidence: 7, ease: 6 }) {
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice,
      contacts: [{ name: 'Jordan Smith', email: `jordan@${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`, phone: '+1 555 0100', isDecisionMaker: true }],
    }),
  }));
  expect(res.status).toBe(201);

  const listRes = await leadsGET(req('/api/leads?brand=cogmap'));
  const listBody = await listRes.json();
  const created = listBody.leads.find((l: any) => l.entity_name === entityName);
  expect(created).toBeTruthy();
  return created._id as string;
}

describe('GET /api/leads/[id]', () => {
  it('returns 404 for a well-formed but nonexistent ObjectId', async () => {
    const res = await idGET(
      req('/api/leads/507f1f77bcf86cd799439011?brand=cogmap'),
      { params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }) }
    );
    expect(res.status).toBe(404);
  });

  it('fetches a lead created via POST', async () => {
    const id = await createLead('Fetchable FC');
    const res = await idGET(
      req(`/api/leads/${id}?brand=cogmap`),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entity_name).toBe('Fetchable FC');
    // Regression guard, same bug as leads.integration.test.ts's create test:
    // country was persisted by createLead's own POST here, this confirms
    // the read path round-trips it correctly too.
    expect(body.country).toBe('US');
  });
});

// Direct DB insert, not createLead() above — createLead() goes through the
// real POST quality gate, which rejects a fixture with no contact under
// certain ICE combinations (a disclosed, pre-existing gap, see
// docs/STACK_AND_DEPENDENCIES.md's Known Issues). This test only needs an
// existing lead to PUT against, so seeding directly avoids depending on
// that unrelated gate.
async function seedLeadDirect(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection('leads').insertOne({
    entity_name: entityName,
    tenantId: 'default',
    country: 'US',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

describe('PUT /api/leads/[id]', () => {
  it('updates country (regression guard — this field was validated on create but never persisted or updatable until 2026-07-27, see CHANGELOG.md)', async () => {
    const id = await seedLeadDirect('Country Update FC');
    const res = await idPUT(
      req(`/api/leads/${id}?brand=cogmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: 'GB' }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.country).toBe('GB');
  });

  it('coerces string-typed ICE fields to real numbers (regression guard for the 2.4.8 corruption class)', async () => {
    const id = await createLead('Coercion Test FC');
    const res = await idPUT(
      req(`/api/leads/${id}?brand=cogmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ice: { impact: '9', confidence: '8', ease: '7' } }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ice.impact).toBe(9);
    expect(typeof body.ice.impact).toBe('number');
    expect(body.ice.confidence).toBe(8);
    expect(body.ice.ease).toBe(7);
  });

  it('auto-reclassifies a DISCOVERED lead to QUALIFIED when its ICE score crosses the 500 threshold', async () => {
    // impact*confidence*ease = 3*3*3 = 27 -> starts DISCOVERED
    const id = await createLead('Reclassify Test FC', { impact: 3, confidence: 3, ease: 3 });
    const before = await idGET(req(`/api/leads/${id}?brand=cogmap`), { params: Promise.resolve({ id }) });
    expect((await before.json()).kanbanColumn).toBe('DISCOVERED');

    // 8*8*8 = 512 >= 500 -> should auto-move to QUALIFIED, since kanbanColumn is not explicitly set in this request
    const res = await idPUT(
      req(`/api/leads/${id}?brand=cogmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ice: { impact: 8, confidence: 8, ease: 8 } }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kanbanColumn).toBe('QUALIFIED');
  });

  it('does not auto-reclassify a lead already moved to a manual column (e.g. WON)', async () => {
    const id = await createLead('Manual Lane Test FC', { impact: 3, confidence: 3, ease: 3 });
    // Explicitly move to WON first
    await idPUT(
      req(`/api/leads/${id}?brand=cogmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanbanColumn: 'WON' }),
      }),
      { params: Promise.resolve({ id }) }
    );
    // Now raise ICE score without touching kanbanColumn — should stay WON, not auto-move
    const res = await idPUT(
      req(`/api/leads/${id}?brand=cogmap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ice: { impact: 9, confidence: 9, ease: 9 } }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kanbanColumn).toBe('WON');
  });
});

describe('DELETE /api/leads/[id]', () => {
  it('deletes a lead and a subsequent GET 404s', async () => {
    const id = await createLead('Deletable FC');
    const delRes = await idDELETE(
      req(`/api/leads/${id}?brand=cogmap`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) }
    );
    expect(delRes.status).toBe(200);

    const getRes = await idGET(req(`/api/leads/${id}?brand=cogmap`), { params: Promise.resolve({ id }) });
    expect(getRes.status).toBe(404);
  });

  // Regression guard for a real bug this same fix uncovered: tryFindLead()'s
  // final fallback branch built its query as `{ $or: [...], ...filter }` —
  // for the 'default' tenant, buildTenantFilter() itself returns an object
  // whose own top-level key is $or, so the spread silently overwrote the
  // id/_id match entirely (JS object spread — the later key wins). A GET for
  // a genuinely nonexistent id degraded to "any document in this tenant"
  // instead of 404 — confirmed live by seeing an unrelated lead's data
  // returned for an id that had just been deleted, not assumed.
  it('404s for a well-formed ObjectId that was never a real numeric/legacy id, rather than returning an arbitrary other lead', async () => {
    await createLead('Distinct Bystander FC');
    const neverExisted = '507f1f77bcf86cd799439099';
    const res = await idGET(
      req(`/api/leads/${neverExisted}?brand=cogmap`),
      { params: Promise.resolve({ id: neverExisted }) }
    );
    expect(res.status).toBe(404);
  });
});

// The "no x-api-key header required even when SLG_API_KEY is configured"
// regression test for this route lives in
// leads-patch-actions.integration.test.ts instead of here: lib/api-auth.ts
// reads SLG_API_KEY once at module import time (see mongo-test-server.ts's
// own comment on this), and this file's beforeAll already imported DELETE
// with no key set — setting process.env.SLG_API_KEY inside an individual
// `it` here would be too late to affect the already-evaluated module.
