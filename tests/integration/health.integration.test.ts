import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/health/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/health/route');
  GET = mod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

describe('GET /api/health', () => {
  it('reports ok with a real ping and brand-keyed lead counts when configured', async () => {
    const res = await GET(req('/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.database).not.toBe('unavailable');
    expect(typeof body.dbLatencyMs).toBe('number');
    expect(body.leadCounts).toHaveProperty('cogmap');
    expect(body.leadCounts).toHaveProperty('seyu');
  });
});

describe('GET /api/health — unconfigured (regression guard for the 2.4.22 dead-code fix)', () => {
  it('returns 503 via the real guard, not the previously-dead branch, when MONGODB_URI is unset', async () => {
    // The route's guard reads process.env.MONGODB_URI live, at request time —
    // unlike lib/mongodb.ts's own clientPromise (created once at module load
    // and unaffected by this), so toggling the env var here and reusing the
    // already-imported GET is enough to exercise the real guard branch.
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    try {
      const res = await GET(req('/api/health'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.lastError.message).toBe('Database client not configured');
    } finally {
      process.env.MONGODB_URI = original;
    }
  });
});
