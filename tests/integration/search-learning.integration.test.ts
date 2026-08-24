import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let POST: typeof import('../../app/api/search-learning/route').POST;
let GET: typeof import('../../app/api/search-learning/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/search-learning/route');
  POST = mod.POST;
  GET = mod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function post(body: Record<string, unknown>) {
  return buildApiRequest('/api/search-learning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Regression guard for the upsert path-conflict bug: `$setOnInsert` seeded
// `searchRuns: 0` and `lastQueries: []` while `$inc`/`$push` in the same
// update also targeted those exact paths. MongoDB rejects that outright
// (error code 40, "would create a conflict at 'searchRuns'"), so the very
// first write for any new companyId threw a real 500 and stored nothing —
// reproduced live against production credentials before the fix, not assumed.
describe('POST /api/search-learning — first write for a new companyId', () => {
  it('inserts instead of throwing a Mongo path-conflict error', async () => {
    const res = await POST(post({
      company: 'brand-new-company',
      query: 'youth football academy',
      outcome: 'ACCEPT',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('initializes searchRuns to 1 and lastQueries to the pushed query', async () => {
    await POST(post({
      company: 'counter-init-company',
      query: 'first query',
      outcome: 'ACCEPT',
    }));

    const res = await GET(buildApiRequest('/api/search-learning?company=counter-init-company'));
    const body = await res.json();

    // The removed $setOnInsert seeds intended exactly this: 0 then +1, and
    // [] then push. $inc/$push on an absent field produce it directly.
    expect(body.totalRuns).toBe(1);
    expect(body.lastQueries).toEqual(['first query']);
  });

  it('keeps incrementing on subsequent writes for the same company', async () => {
    for (const q of ['q1', 'q2', 'q3']) {
      const res = await POST(post({ company: 'repeat-company', query: q, outcome: 'DECLINE' }));
      expect(res.status).toBe(200);
    }

    const res = await GET(buildApiRequest('/api/search-learning?company=repeat-company'));
    const body = await res.json();
    expect(body.totalRuns).toBe(3);
    expect(body.lastQueries).toEqual(['q1', 'q2', 'q3']);
  });

  it('still rejects a payload with no query, before touching the database', async () => {
    const res = await POST(post({ company: 'validation-company', outcome: 'ACCEPT' }));
    expect(res.status).toBe(400);

    // Nothing should have been created for a rejected payload.
    const check = await GET(buildApiRequest('/api/search-learning?company=validation-company'));
    const body = await check.json();
    expect(body.totalRuns).toBe(0);
  });
});
