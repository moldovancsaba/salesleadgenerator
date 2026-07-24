import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let idPUT: typeof import('../../app/api/leads/[id]/route').PUT;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let columnsGET: typeof import('../../app/api/leads/columns/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/leads/route');
  leadsPOST = listMod.POST;
  leadsGET = listMod.GET;
  const idMod = await import('../../app/api/leads/[id]/route');
  idPUT = idMod.PUT;
  const columnsMod = await import('../../app/api/leads/columns/route');
  columnsGET = columnsMod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

async function createLead(entityName: string, ice: { impact: number; confidence: number; ease: number }) {
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
  return listBody.leads.find((l: any) => l.entity_name === entityName)._id as string;
}

describe('GET /api/leads/columns — DISCOVERED (auto-managed, sorted by computed ICE score)', () => {
  it('sorts leads in DISCOVERED by ICE score, high to low, even though no sortOrder was ever set', async () => {
    // All start DISCOVERED (low ICE), inserted in low-to-high creation order —
    // the response must come back sorted by score, not by insertion order.
    await createLead('Low Score FC', { impact: 2, confidence: 2, ease: 2 }); // score 8
    await createLead('High Score FC', { impact: 4, confidence: 4, ease: 4 }); // score 64
    await createLead('Mid Score FC', { impact: 3, confidence: 3, ease: 3 }); // score 27

    const res = await columnsGET(req('/api/leads/columns?brand=cogmap&column=DISCOVERED'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toEqual(['High Score FC', 'Mid Score FC', 'Low Score FC']);
  });
});

describe('GET /api/leads/columns — WON (manual, sorted by sortOrder)', () => {
  it('sorts leads in WON by sortOrder/createdAt, not by ICE score', async () => {
    const idA = await createLead('WON Alpha FC', { impact: 9, confidence: 9, ease: 9 }); // high score
    const idB = await createLead('WON Beta FC', { impact: 2, confidence: 2, ease: 2 }); // low score

    await idPUT(
      req(`/api/leads/${idA}?brand=cogmap`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanbanColumn: 'WON' }),
      }),
      { params: Promise.resolve({ id: idA }) }
    );
    await idPUT(
      req(`/api/leads/${idB}?brand=cogmap`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanbanColumn: 'WON' }),
      }),
      { params: Promise.resolve({ id: idB }) }
    );

    const res = await columnsGET(req('/api/leads/columns?brand=cogmap&column=WON'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name).sort();
    expect(names).toEqual(['WON Alpha FC', 'WON Beta FC']);
  });

  it('rejects a request with a missing or invalid column parameter', async () => {
    const res = await columnsGET(req('/api/leads/columns?brand=cogmap'));
    expect(res.status).toBe(400);
  });
});
