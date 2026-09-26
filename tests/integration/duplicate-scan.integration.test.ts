import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// Same mocked session boundary as duplicate-review-merge.integration.test.ts:
// requireSuperAdminSession verifies a real SSO JWT against a live JWKS
// endpoint, which this sandbox cannot sign for.
const requireSuperAdminSessionMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
}));

let mongod: MongoMemoryServer;
let scanPOST: typeof import('../../app/api/admin/duplicate-scan/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  scanPOST = (await import('../../app/api/admin/duplicate-scan/route')).POST;
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'test-admin', email: 'admin@test.example.com' });
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  return (await clientPromise).db();
}

async function seedLead(entityName: string): Promise<string> {
  const database = await db();
  const result = await database.collection('leads').insertOne({
    entity_name: entityName,
    url: `https://${entityName.toLowerCase().replace(/[^a-z]/g, '')}.example.com`,
    sport_or_sector: 'Football',
    sportCode: 'FOOTBALL',
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return result.insertedId.toString();
}

async function scan() {
  const res = await scanPOST(new NextRequest('http://localhost/api/admin/duplicate-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand: 'cogmap' }),
  }));
  return { status: res.status, body: await res.json() };
}

describe('POST /api/admin/duplicate-scan', () => {
  it('rejects a request the session check rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const { status } = await scan();
    expect(status).toBe(401);
  });

  it('inserts a candidate pair once, with sorted ids, and does not re-insert it on a re-scan', async () => {
    const idA = await seedLead('Lambda Rovers FC');
    const idB = await seedLead('Lambda Rovers F.C.');

    const first = await scan();
    expect(first.status).toBe(200);
    expect(first.body.newPairs).toBe(1);
    expect(first.body.truncated).toBe(false);

    const rows = await (await db()).collection('duplicate_reviews').find({ brand: 'cogmap' }).toArray();
    expect(rows).toHaveLength(1);
    expect([rows[0].leadIdA, rows[0].leadIdB]).toEqual([idA, idB].sort());

    const second = await scan();
    expect(second.body.candidatesFound).toBe(1);
    expect(second.body.newPairs).toBe(0);
    expect(second.body.unresolvedPairs).toBe(1);
  });

  // Issue #137: a merge used to leave repointed rows stored in reverse
  // order, and the scan's lookup keyed on stored order, so a dismissed pair
  // came back as a new pending row.
  it('recognises a decided pair stored in reverse order and does not resurface it', async () => {
    const database = await db();
    const row = await database.collection('duplicate_reviews').findOne({ brand: 'cogmap' });
    expect(row).not.toBeNull();
    await database.collection('duplicate_reviews').updateOne(
      { _id: row!._id },
      { $set: { leadIdA: row!.leadIdB, leadIdB: row!.leadIdA, status: 'dismissed' } }
    );

    const res = await scan();
    expect(res.body.newPairs).toBe(0);
    expect(res.body.candidatesFound).toBe(1);
    expect(res.body.unresolvedPairs).toBe(0);
    expect(await database.collection('duplicate_reviews').countDocuments({ brand: 'cogmap' })).toBe(1);
  });
});
