import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

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

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
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
  });
});

describe('PUT /api/leads/[id]', () => {
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
});
