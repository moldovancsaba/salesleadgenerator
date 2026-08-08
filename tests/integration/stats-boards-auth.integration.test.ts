import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// Issue #178 — GET /api/stats and GET /api/boards had no auth check at all
// despite returning real per-brand lead counts, revenue/forecast data, and
// brand/tenant config. Both are now gated with requireApiKey, matching every
// other data-exposing admin route in this repo.

let mongod: MongoMemoryServer;
let statsGET: typeof import('../../app/api/stats/route').GET;
let boardsGET: typeof import('../../app/api/boards/route').GET;

const TEST_API_KEY = 'test-stats-boards-key';

beforeAll(async () => {
  mongod = await startTestMongo();
  // lib/api-auth.ts reads SLG_API_KEY once at module load — must be set
  // before the first dynamic import of either route, same constraint as
  // every other integration test in this repo that exercises requireApiKey.
  process.env.SLG_API_KEY = TEST_API_KEY;
  const statsMod = await import('../../app/api/stats/route');
  statsGET = statsMod.GET;
  const boardsMod = await import('../../app/api/boards/route');
  boardsGET = boardsMod.GET;
}, 60000);

afterAll(async () => {
  delete process.env.SLG_API_KEY;
  await stopTestMongo(mongod);
});

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

function authedReq(url: string, init?: RequestInit) {
  return req(url, { ...init, headers: { ...(init?.headers || {}), 'x-api-key': TEST_API_KEY } });
}

describe('GET /api/stats — auth', () => {
  it('rejects a request with no auth', async () => {
    const res = await statsGET(req('/api/stats'));
    expect(res.status).toBe(401);
  });

  it('rejects a request with a wrong x-api-key', async () => {
    const res = await statsGET(req('/api/stats', { headers: { 'x-api-key': 'wrong' } }));
    expect(res.status).toBe(401);
  });

  it('accepts the admin x-api-key', async () => {
    const res = await statsGET(authedReq('/api/stats'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('brands');
    expect(body).toHaveProperty('total');
  });
});

describe('GET /api/boards — auth', () => {
  it('rejects a request with no auth', async () => {
    const res = await boardsGET(req('/api/boards'));
    expect(res.status).toBe(401);
  });

  it('rejects a request with a wrong x-api-key', async () => {
    const res = await boardsGET(req('/api/boards', { headers: { 'x-api-key': 'wrong' } }));
    expect(res.status).toBe(401);
  });

  it('accepts the admin x-api-key', async () => {
    const res = await boardsGET(authedReq('/api/boards'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('boards');
    expect(Array.isArray(body.boards)).toBe(true);
  });
});
