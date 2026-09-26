import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #227: POST/PUT/DELETE were requireApiKey-only (so the browser page got
// 401 in production), both GETs had no guard at all, and nothing tied a card
// id to the request's brand. Every handler now requires ?brand= and
// requireBrandAccessApi, and every lookup/write is filtered by brand.

let mongod: MongoMemoryServer;
let seyuKey: string;
let listGET: typeof import('../../app/api/battlecards/route').GET;
let listPOST: typeof import('../../app/api/battlecards/route').POST;
let cardGET: typeof import('../../app/api/battlecards/[id]/route').GET;
let cardPUT: typeof import('../../app/api/battlecards/[id]/route').PUT;
let cardDELETE: typeof import('../../app/api/battlecards/[id]/route').DELETE;

async function testDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  return (await clientPromise).db();
}

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/battlecards/route');
  listGET = listMod.GET;
  listPOST = listMod.POST;
  const cardMod = await import('../../app/api/battlecards/[id]/route');
  cardGET = cardMod.GET;
  cardPUT = cardMod.PUT;
  cardDELETE = cardMod.DELETE;
  const { createApiKey } = await import('../../app/lib/api-key-store');
  seyuKey = (await createApiKey(await testDb(), { name: 'seyu-only', brand: 'seyu', scopes: ['read-write'] }, 'test')).rawKey;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function anonymous(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

function withSeyuKey(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-api-key': seyuKey } });
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const validCard = {
  competitorName: 'Rival Analytics',
  positioningSummary: 'We ship faster onboarding than Rival.',
  proofPoints: ['Two-week rollout'],
  objections: [{ objection: 'Rival is cheaper', response: 'Our total cost is lower.' }],
  tags: ['pricing'],
};

async function createCogmapCard(overrides: Record<string, unknown> = {}) {
  const res = await listPOST(buildApiRequest('/api/battlecards?brand=cogmap', json('POST', { ...validCard, ...overrides })));
  expect(res.status).toBe(201);
  return res.json();
}

async function storedCard(id: string) {
  return (await testDb()).collection('battlecards').findOne({ _id: new ObjectId(id) });
}

describe('battlecards auth (issue 227)', () => {
  it('GET list refuses a request with no credential', async () => {
    const res = await listGET(anonymous('/api/battlecards?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('POST refuses a request with no credential and writes nothing', async () => {
    const res = await listPOST(anonymous('/api/battlecards?brand=cogmap', json('POST', { ...validCard, competitorName: 'Anonymous Co' })));
    expect(res.status).toBe(401);
    expect(await (await testDb()).collection('battlecards').findOne({ competitorName: 'Anonymous Co' })).toBeNull();
  });

  it('GET [id] refuses a request with no credential', async () => {
    const created = await createCogmapCard();
    const res = await cardGET(anonymous(`/api/battlecards/${created.id}?brand=cogmap`), idParams(created.id));
    expect(res.status).toBe(401);
  });

  it('PUT [id] refuses a request with no credential and leaves the card unchanged', async () => {
    const created = await createCogmapCard();
    const res = await cardPUT(
      anonymous(`/api/battlecards/${created.id}?brand=cogmap`, json('PUT', { competitorName: 'Hijacked' })),
      idParams(created.id)
    );
    expect(res.status).toBe(401);
    expect((await storedCard(created.id))?.competitorName).toBe(validCard.competitorName);
  });

  it('DELETE [id] refuses a request with no credential and leaves the card in place', async () => {
    const created = await createCogmapCard();
    const res = await cardDELETE(anonymous(`/api/battlecards/${created.id}?brand=cogmap`, { method: 'DELETE' }), idParams(created.id));
    expect(res.status).toBe(401);
    expect(await storedCard(created.id)).not.toBeNull();
  });

  it('refuses another brand\'s scoped key on list and write', async () => {
    const listRes = await listGET(withSeyuKey('/api/battlecards?brand=cogmap'));
    expect(listRes.status).toBe(403);

    const created = await createCogmapCard();
    const putRes = await cardPUT(
      withSeyuKey(`/api/battlecards/${created.id}?brand=cogmap`, json('PUT', { competitorName: 'Hijacked' })),
      idParams(created.id)
    );
    expect(putRes.status).toBe(403);
    expect((await storedCard(created.id))?.competitorName).toBe(validCard.competitorName);
  });
});

describe('battlecards brand parameter (issue 227)', () => {
  it('rejects a missing or empty brand with 400 instead of defaulting to cogmap', async () => {
    expect((await listGET(buildApiRequest('/api/battlecards'))).status).toBe(400);
    expect((await listGET(buildApiRequest('/api/battlecards?brand='))).status).toBe(400);
    expect((await listPOST(buildApiRequest('/api/battlecards', json('POST', validCard)))).status).toBe(400);

    const created = await createCogmapCard();
    expect((await cardGET(buildApiRequest(`/api/battlecards/${created.id}`), idParams(created.id))).status).toBe(400);
    expect((await cardPUT(buildApiRequest(`/api/battlecards/${created.id}`, json('PUT', { competitorName: 'X' })), idParams(created.id))).status).toBe(400);
    expect((await cardDELETE(buildApiRequest(`/api/battlecards/${created.id}`, { method: 'DELETE' }), idParams(created.id))).status).toBe(400);
  });

  it('rejects an unknown brand with 400 Invalid brand', async () => {
    const res = await listPOST(buildApiRequest('/api/battlecards?brand=not-a-brand', json('POST', validCard)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid brand');

    const created = await createCogmapCard();
    const getRes = await cardGET(buildApiRequest(`/api/battlecards/${created.id}?brand=not-a-brand`), idParams(created.id));
    expect(getRes.status).toBe(400);
  });

  it('stores the resolved slug when a brand alias is supplied', async () => {
    const res = await listPOST(buildApiRequest('/api/battlecards?brand=CogMapSales', json('POST', { ...validCard, competitorName: 'Alias Co' })));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.brand).toBe('cogmap');
    expect((await storedCard(created.id))?.brand).toBe('cogmap');
  });
});

describe('battlecards CRUD with the legacy key (issue 227)', () => {
  it('creates, lists, reads, updates and deletes a cogmap card', async () => {
    const created = await createCogmapCard({ competitorName: 'Lifecycle Co' });
    expect(created.brand).toBe('cogmap');
    expect((await storedCard(created.id))?.brand).toBe('cogmap');

    const listRes = await listGET(buildApiRequest('/api/battlecards?brand=cogmap'));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.brand).toBe('cogmap');
    expect(listBody.battlecards.some((b: any) => b.id === created.id)).toBe(true);

    const getRes = await cardGET(buildApiRequest(`/api/battlecards/${created.id}?brand=cogmap`), idParams(created.id));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).competitorName).toBe('Lifecycle Co');

    const putRes = await cardPUT(
      buildApiRequest(`/api/battlecards/${created.id}?brand=cogmap`, json('PUT', { competitorName: 'Lifecycle Renamed' })),
      idParams(created.id)
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).competitorName).toBe('Lifecycle Renamed');

    const delRes = await cardDELETE(buildApiRequest(`/api/battlecards/${created.id}?brand=cogmap`, { method: 'DELETE' }), idParams(created.id));
    expect(delRes.status).toBe(204);
    expect(await storedCard(created.id)).toBeNull();
  });

  it('does not list a cogmap card under seyu', async () => {
    const created = await createCogmapCard({ competitorName: 'Cogmap Only Co' });
    const listRes = await listGET(buildApiRequest('/api/battlecards?brand=seyu'));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.battlecards.some((b: any) => b.id === created.id)).toBe(false);
  });
});

describe('battlecards cross-brand id (issue 227)', () => {
  it('GET with another brand returns 404', async () => {
    const created = await createCogmapCard();
    const res = await cardGET(buildApiRequest(`/api/battlecards/${created.id}?brand=seyu`), idParams(created.id));
    expect(res.status).toBe(404);
  });

  it('PUT with another brand returns 404 and cannot slip that brand\'s own terms into the card', async () => {
    const created = await createCogmapCard();
    // "seyu" is a forbidden term for cogmap but not for seyu, so validating
    // against the request brand instead of the card's own brand let it through.
    const res = await cardPUT(
      buildApiRequest(`/api/battlecards/${created.id}?brand=seyu`, json('PUT', { positioningSummary: 'Seyu fan selfie on the LED screen' })),
      idParams(created.id)
    );
    expect(res.status).toBe(404);
    const stored = await storedCard(created.id);
    expect(stored?.positioningSummary).toBe(validCard.positioningSummary);
    expect(stored?.brand).toBe('cogmap');
  });

  it('PUT under the card\'s own brand still rejects another brand\'s terms', async () => {
    const created = await createCogmapCard();
    const res = await cardPUT(
      buildApiRequest(`/api/battlecards/${created.id}?brand=cogmap`, json('PUT', { positioningSummary: 'Seyu fan selfie on the LED screen' })),
      idParams(created.id)
    );
    expect(res.status).toBe(400);
    expect((await storedCard(created.id))?.positioningSummary).toBe(validCard.positioningSummary);
  });

  it('DELETE with another brand returns 404 and leaves the card in place', async () => {
    const created = await createCogmapCard();
    const res = await cardDELETE(buildApiRequest(`/api/battlecards/${created.id}?brand=seyu`, { method: 'DELETE' }), idParams(created.id));
    expect(res.status).toBe(404);
    expect(await storedCard(created.id)).not.toBeNull();
  });
});
