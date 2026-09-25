import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest, TEST_API_KEY } from './helpers/api-request';

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/settings/route').GET;
let PUT: typeof import('../../app/api/settings/route').PUT;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/settings/route');
  GET = mod.GET;
  PUT = mod.PUT;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

describe('GET/PUT /api/settings — wipLimits (issue 213)', () => {
  it('GET defaults wipLimits/wipLimitsSource when nothing is configured', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.wipLimits).toBeTruthy();
    expect(body.wipLimitsSource).toBe('default');
  });

  it('PUT persists a configured wipLimits object, GET then reports it from mongodb', async () => {
    const putRes = await PUT(buildApiRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
      body: JSON.stringify({ wipLimits: { ENGAGED: 5, PROPOSAL: 3 } }),
    }));
    expect(putRes.status).toBe(200);

    const getRes = await GET();
    const body = await getRes.json();
    expect(body.wipLimits).toEqual({ ENGAGED: 5, PROPOSAL: 3 });
    expect(body.wipLimitsSource).toBe('mongodb');
  });

  it('PUT rejects a non-object wipLimits', async () => {
    const res = await PUT(buildApiRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
      body: JSON.stringify({ wipLimits: 'not-an-object' }),
    }));
    expect(res.status).toBe(400);
  });
});
