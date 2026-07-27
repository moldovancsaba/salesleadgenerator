import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// requireSuperAdminSession does real SSO JWT verification against a live
// JWKS endpoint — a real signed token can't be fabricated in this sandbox
// (no private key), the same constraint already documented in
// admin-session-auth.integration.test.ts. Mocked here (a clean dependency
// boundary, not a forged token) so this file can exercise the actual merge
// business logic — the FK-repointing/hard-delete/field-merge sequence is the
// highest-risk part of this feature and deserves real DB-backed coverage,
// not just a 401 check.
const requireSuperAdminSessionMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
}));

let mongod: MongoMemoryServer;
let mergeGET: typeof import('../../app/api/duplicate-reviews/merge/route').GET;
let mergePOST: typeof import('../../app/api/duplicate-reviews/merge/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/duplicate-reviews/merge/route');
  mergeGET = mod.GET;
  mergePOST = mod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedLead(overrides: Record<string, unknown> = {}): Promise<string> {
  const database = await db();
  const result = await database.collection('leads').insertOne({
    entity_name: 'Acme FC',
    url: 'https://acme-fc.example.com',
    country: 'US',
    region: 'US',
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    sortOrder: 100,
    qualityStatus: 'DRAFT',
    feedbackScore: 0,
    declineCount: 0,
    acceptanceCount: 0,
    contacts: [],
    tags: [],
    deals: [],
    checklist: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return result.insertedId.toString();
}

async function seedReview(leadIdA: string, leadIdB: string, status: 'pending' | 'confirmed' | 'dismissed' = 'confirmed'): Promise<string> {
  const database = await db();
  const [a, b] = [leadIdA, leadIdB].sort();
  const result = await database.collection('duplicate_reviews').insertOne({
    tenantId: 'default',
    brand: 'cogmap',
    leadIdA: a,
    leadIdB: b,
    score: 0.9,
    matchedOn: 'name',
    status,
    createdAt: new Date(),
  });
  return result.insertedId.toString();
}

beforeAll(() => {
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'test-admin', email: 'admin@test.example.com' });
});

describe('GET /api/duplicate-reviews/merge — auth gate', () => {
  it('rejects a request the session check itself rejects (401), matching every other /admin/duplicates-adjacent route', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await mergeGET(req('/api/duplicate-reviews/merge?reviewId=000000000000000000000000'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/duplicate-reviews/merge — preview', () => {
  it('returns zero conflicts for two identical leads', async () => {
    const idA = await seedLead({ entity_name: 'Acme FC' });
    const idB = await seedLead({ entity_name: 'Acme FC' });
    const reviewId = await seedReview(idA, idB);

    const res = await mergeGET(req(`/api/duplicate-reviews/merge?reviewId=${reviewId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const conflicts = body.classifications.filter((c: any) => c.kind === 'conflict');
    expect(conflicts).toEqual([]);
  });

  it('surfaces a real conflict for genuinely different values', async () => {
    const idA = await seedLead({ entity_name: 'Beta Corp', value_proposition: 'Speed' });
    const idB = await seedLead({ entity_name: 'Beta Corp', value_proposition: 'Reliability' });
    const reviewId = await seedReview(idA, idB);

    const res = await mergeGET(req(`/api/duplicate-reviews/merge?reviewId=${reviewId}`));
    const body = await res.json();
    const vpConflict = body.classifications.find((c: any) => c.field === 'value_proposition');
    expect(vpConflict?.kind).toBe('conflict');
  });

  it('404s when the review row does not exist', async () => {
    const res = await mergeGET(req('/api/duplicate-reviews/merge?reviewId=000000000000000000000000'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/duplicate-reviews/merge — commit', () => {
  it('rejects a pair whose review status is not confirmed', async () => {
    const idA = await seedLead({ entity_name: 'Gamma LLC' });
    const idB = await seedLead({ entity_name: 'Gamma LLC' });
    const reviewId = await seedReview(idA, idB, 'pending');

    const res = await mergePOST(req('/api/duplicate-reviews/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, primaryId: idA, resolutions: {} }),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a merge missing a resolution for a real conflict', async () => {
    const idA = await seedLead({ entity_name: 'Delta Inc' });
    const idB = await seedLead({ entity_name: 'Delta Incorporated' });
    const reviewId = await seedReview(idA, idB, 'confirmed');

    const res = await mergePOST(req('/api/duplicate-reviews/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, primaryId: idA, resolutions: {} }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/entity_name/);
  });

  it('merges two leads with a real conflict, unions contacts/tags, hard-deletes the secondary, and repoints FK collections', async () => {
    const idA = await seedLead({
      entity_name: 'Epsilon Sports',
      value_proposition: 'Faster onboarding',
      tags: ['europe'],
      contacts: [{ name: 'Jordan Smith', email: 'jordan@epsilon.example.com' }],
    });
    const idB = await seedLead({
      entity_name: 'Epsilon Sports',
      value_proposition: 'Lower cost',
      tags: ['renewal'],
      contacts: [{ name: 'Alex Rivera', phone: '+1 555 0101' }],
    });
    const reviewId = await seedReview(idA, idB, 'confirmed');

    // Seed FK-shaped references to the lead that will be merged away (idB),
    // plus a second, unrelated review row also naming idB — both must be
    // repointed onto idA, not silently orphaned by the hard delete.
    const database = await db();
    await database.collection('outcomelogs').insertOne({ leadId: idB, action: 'COLUMN_MOVE', createdAt: new Date() });
    await database.collection('outreach_logs').insertOne({ tenantId: 'default', leadId: idB, brand: 'cogmap', channel: 'email', body: 'hi', createdAt: new Date() });
    const idC = await seedLead({ entity_name: 'Unrelated Third Lead' });
    const otherReviewId = await seedReview(idB, idC, 'pending');

    const res = await mergePOST(req('/api/duplicate-reviews/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, primaryId: idA, resolutions: { value_proposition: 'A' } }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.primaryId).toBe(idA);
    expect(body.secondaryId).toBe(idB);

    const primary = await database.collection('leads').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(idA) });
    expect(primary?.value_proposition).toBe('Faster onboarding');
    expect(primary?.tags.sort()).toEqual(['europe', 'renewal']);
    expect(primary?.contacts).toHaveLength(2);

    const secondary = await database.collection('leads').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(idB) });
    expect(secondary).toBeNull();

    const outcomeLog = await database.collection('outcomelogs').findOne({ leadId: idA });
    expect(outcomeLog).not.toBeNull();
    const outreachLog = await database.collection('outreach_logs').findOne({ leadId: idA });
    expect(outreachLog).not.toBeNull();

    const otherReview = await database.collection('duplicate_reviews').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(otherReviewId) });
    expect(otherReview?.leadIdA === idA || otherReview?.leadIdB === idA).toBe(true);

    const drivingReview = await database.collection('duplicate_reviews').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(reviewId) });
    expect(drivingReview?.status).toBe('merged');
    expect(drivingReview?.mergedInto).toBe(idA);
  });

  it('404s when a lead in the pair was already deleted (re-running an already-completed merge)', async () => {
    const idA = await seedLead({ entity_name: 'Zeta Co' });
    const idB = await seedLead({ entity_name: 'Zeta Co' });
    const reviewId = await seedReview(idA, idB, 'confirmed');

    const first = await mergePOST(req('/api/duplicate-reviews/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, primaryId: idA, resolutions: {} }),
    }));
    expect(first.status).toBe(200);

    const second = await mergePOST(req('/api/duplicate-reviews/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, primaryId: idA, resolutions: {} }),
    }));
    expect(second.status).toBe(404);
  });
});
