import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// PATCH /api/leads/bulk (issue #70) — reuses executeLeadAction per lead, so
// most business-logic edge cases are already covered by
// leads-patch-actions.integration.test.ts; this file focuses on what's new
// here: partial failure reporting and the request-size cap.
//
// Bulk actions v2 (issue #203) — also covers FIELD_EDIT/ASSIGN and the
// server-verified undo flow (POST /api/leads/bulk/undo, same file as its
// sibling per this repo's own leads-activity.integration.test.ts
// precedent). ASSIGN needs a real verified session — resolveSessionFromIdToken
// mocked as a clean dependency boundary, same convention as
// tests/integration/leads.integration.test.ts's own ASSIGN coverage (this
// sandbox cannot mint a real signed SSO JWT).
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let PATCH: typeof import('../../app/api/leads/bulk/route').PATCH;
let undoPOST: typeof import('../../app/api/leads/bulk/undo/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  PATCH = (await import('../../app/api/leads/bulk/route')).PATCH;
  undoPOST = (await import('../../app/api/leads/bulk/undo/route')).POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
});

// No x-api-key — forces requireBrandAccessApi through its session branch,
// needed for ASSIGN's actor resolution (same helper/reasoning as
// tests/integration/leads.integration.test.ts).
function sessionReq(url: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function undoReq(body: Record<string, unknown>) {
  return buildApiRequest('/api/leads/bulk/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const now = new Date().toISOString();
  await client.db().collection('sso_user_access').insertOne({
    ssoUserId: overrides.ssoUserId, email: overrides.email, orgAccess: overrides.orgAccess,
    createdAt: now, updatedAt: now,
  });
}

async function seedLead(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection('leads').insertOne({
    entity_name: entityName,
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

function req(body: Record<string, unknown>) {
  return buildApiRequest('/api/leads/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/leads/bulk', () => {
  it('rejects an unsupported action', async () => {
    const res = await PATCH(req({ brand: 'cogmap', leadIds: ['x'], action: 'MODIFY' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty leadIds array', async () => {
    const res = await PATCH(req({ brand: 'cogmap', leadIds: [], action: 'DECLINE' }));
    expect(res.status).toBe(400);
  });

  it('rejects a request over the 100-lead cap without processing any of it', async () => {
    const leadIds = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await PATCH(req({ brand: 'cogmap', leadIds, action: 'DECLINE' }));
    expect(res.status).toBe(400);
  });

  it('declines every lead in the batch and reports per-item success', async () => {
    const id1 = await seedLead('Bulk Decline Co A');
    const id2 = await seedLead('Bulk Decline Co B');

    const res = await PATCH(req({
      brand: 'cogmap',
      leadIds: [id1, id2],
      action: 'DECLINE',
      payload: { declineReason: 'OTHER' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { leadId: id1, success: true, error: undefined },
      { leadId: id2, success: true, error: undefined },
    ]);
  });

  it('accepts every lead in the batch and reports per-item success (2026-09-02: joined DECLINE/PIN)', async () => {
    // The review-feedback loop was near-unusable at scale because declining a
    // backlog could be done in bulk and accepting one could not (1 of 3,027
    // leads ever accepted on one tenant) -- this is the fix, mirroring the
    // bulk-decline test above exactly.
    const id1 = await seedLead('Bulk Accept Co A');
    const id2 = await seedLead('Bulk Accept Co B');

    const res = await PATCH(req({ brand: 'cogmap', leadIds: [id1, id2], action: 'ACCEPT' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { leadId: id1, success: true, error: undefined },
      { leadId: id2, success: true, error: undefined },
    ]);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const { ObjectId } = await import('mongodb');
    const lead = await db.collection('leads').findOne({ _id: new ObjectId(id1) });
    expect(lead?.status).toBe('qualified');
    expect(lead?.acceptanceCount).toBe(1);
    expect(lead?.feedbackScore).toBe(1);
  });

  it('reports a per-item failure without failing the rest of the batch', async () => {
    const validId = await seedLead('Bulk Mixed Co');
    const missingId = '507f1f77bcf86cd799439011'; // well-formed ObjectId, no such document

    const res = await PATCH(req({
      brand: 'cogmap',
      leadIds: [validId, missingId],
      action: 'DECLINE',
      payload: { declineReason: 'OTHER' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ leadId: validId, success: true, error: undefined });
    expect(body.results[1]).toEqual({ leadId: missingId, success: false, error: 'Lead not found' });
  });

  it('reports a per-item failure for a malformed lead id instead of failing the whole batch', async () => {
    const validId = await seedLead('Bulk Malformed Co');
    const malformedId = 'not-a-valid-object-id';

    const res = await PATCH(req({
      brand: 'cogmap',
      leadIds: [validId, malformedId],
      action: 'DECLINE',
      payload: { declineReason: 'OTHER' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(false);
  });

  it('de-duplicates a repeated leadId instead of running the action twice for it (issue #109)', async () => {
    const id = await seedLead('Bulk Duplicate Id Co');

    const res = await PATCH(req({
      brand: 'cogmap',
      leadIds: [id, id, id],
      action: 'DECLINE',
      payload: { declineReason: 'OTHER' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // Exactly one result for the id, not three.
    expect(body.results).toEqual([{ leadId: id, success: true, error: undefined }]);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const { ObjectId } = await import('mongodb');
    const lead = await db.collection('leads').findOne({ _id: new ObjectId(id) });
    // Declined exactly once — a pre-fix bug ran executeLeadAction three
    // times for this single duplicated id, double-decrementing
    // feedbackScore/incrementing declineCount past 1.
    expect(lead?.declineCount).toBe(1);
    expect(lead?.feedbackScore).toBe(-1);
  });

  it('blocks a bulk PIN for a lead missing stage-gate required fields (issue #72 interaction), without failing the batch', async () => {
    const ready = await seedLead('Bulk Pin Ready Co', {
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    const notReady = await seedLead('Bulk Pin Not Ready Co');

    const res = await PATCH(req({ brand: 'cogmap', leadIds: [ready, notReady], action: 'PIN' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ leadId: ready, success: true, error: undefined });
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toContain('Missing required fields for ENGAGED');
  });
});

describe('PATCH /api/leads/bulk — FIELD_EDIT (issue #203)', () => {
  it('rejects an unknown field', async () => {
    const id = await seedLead('Field Edit Bad Field Co');
    const res = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'FIELD_EDIT', payload: { field: 'notes', value: 'x' } }));
    expect(res.status).toBe(400);
  });

  it("adds a tag to each lead's own current tags[], not a shared/replaced array", async () => {
    const id1 = await seedLead('Field Edit Add Tag Co A', { tags: ['existing-a'] });
    const id2 = await seedLead('Field Edit Add Tag Co B', { tags: ['existing-b'] });

    const res = await PATCH(req({
      brand: 'cogmap', leadIds: [id1, id2], action: 'FIELD_EDIT',
      payload: { field: 'tags', op: 'add', value: 'hot-lead' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.every((r: any) => r.success)).toBe(true);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    const lead1 = await client.db().collection('leads').findOne({ _id: new ObjectId(id1) });
    const lead2 = await client.db().collection('leads').findOne({ _id: new ObjectId(id2) });
    expect(lead1?.tags.sort()).toEqual(['existing-a', 'hot-lead']);
    expect(lead2?.tags.sort()).toEqual(['existing-b', 'hot-lead']);
  });

  it('removes a tag from each lead\'s own current tags[]', async () => {
    const id = await seedLead('Field Edit Remove Tag Co', { tags: ['keep-me', 'remove-me'] });
    const res = await PATCH(req({
      brand: 'cogmap', leadIds: [id], action: 'FIELD_EDIT',
      payload: { field: 'tags', op: 'remove', value: 'remove-me' },
    }));
    expect(res.status).toBe(200);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    const lead = await client.db().collection('leads').findOne({ _id: new ObjectId(id) });
    expect(lead?.tags).toEqual(['keep-me']);
  });

  it('sets qualityStatus for every lead in the batch, rejecting an invalid value up front', async () => {
    const invalid = await PATCH(req({ brand: 'cogmap', leadIds: ['x'], action: 'FIELD_EDIT', payload: { field: 'qualityStatus', value: 'NOT_REAL' } }));
    expect(invalid.status).toBe(400);

    const id = await seedLead('Field Edit Quality Status Co', { qualityStatus: 'DRAFT' });
    const res = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'FIELD_EDIT', payload: { field: 'qualityStatus', value: 'CHECKED' } }));
    expect(res.status).toBe(200);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    const lead = await client.db().collection('leads').findOne({ _id: new ObjectId(id) });
    expect(lead?.qualityStatus).toBe('CHECKED');
  });
});

describe('PATCH /api/leads/bulk — ASSIGN (issue #203)', () => {
  it('self-assigns every lead in the selection', async () => {
    await seedUserAccess({ ssoUserId: 'bulk-user-1', email: 'bulk-user-1@test.example.com', orgAccess: { cogmap: 'user' } });
    const id1 = await seedLead('Bulk Self Assign Co A');
    const id2 = await seedLead('Bulk Self Assign Co B');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'bulk-user-1', email: 'bulk-user-1@test.example.com' });
    const res = await PATCH(sessionReq('/api/leads/bulk', {
      brand: 'cogmap', leadIds: [id1, id2], action: 'ASSIGN', payload: { assignedTo: 'bulk-user-1' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.every((r: any) => r.success)).toBe(true);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    const lead1 = await client.db().collection('leads').findOne({ _id: new ObjectId(id1) });
    expect(lead1?.assignedTo).toBe('bulk-user-1');
  });

  it('blocks a non-admin from bulk-assigning to another user, per lead, without failing the request', async () => {
    await seedUserAccess({ ssoUserId: 'bulk-user-2', email: 'bulk-user-2@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'bulk-target-2', email: 'bulk-target-2@test.example.com', orgAccess: { cogmap: 'user' } });
    const id = await seedLead('Bulk Blocked Assign Co');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'bulk-user-2', email: 'bulk-user-2@test.example.com' });
    const res = await PATCH(sessionReq('/api/leads/bulk', {
      brand: 'cogmap', leadIds: [id], action: 'ASSIGN', payload: { assignedTo: 'bulk-target-2' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toMatch(/brand admin/);
  });

  it('allows an admin to bulk-reassign to another user', async () => {
    await seedUserAccess({ ssoUserId: 'bulk-admin-1', email: 'bulk-admin-1@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'bulk-target-3', email: 'bulk-target-3@test.example.com', orgAccess: { cogmap: 'user' } });
    const id = await seedLead('Bulk Admin Assign Co');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'bulk-admin-1', email: 'bulk-admin-1@test.example.com' });
    const res = await PATCH(sessionReq('/api/leads/bulk', {
      brand: 'cogmap', leadIds: [id], action: 'ASSIGN', payload: { assignedTo: 'bulk-target-3' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].success).toBe(true);
  });
});

describe('PATCH /api/leads/bulk — undo capture (issue #203)', () => {
  it('returns an undo token for a successful DECLINE, flagging cadence-cancelled leads as not reversible', async () => {
    const withCadence = await seedLead('Undo Capture Cadence Co', {
      activeCadence: { cadenceId: 'c1', currentStepIndex: 0, stepDueAt: new Date().toISOString(), enrolledAt: new Date().toISOString() },
    });
    const withoutCadence = await seedLead('Undo Capture No Cadence Co');

    const res = await PATCH(req({
      brand: 'cogmap', leadIds: [withCadence, withoutCadence], action: 'DECLINE', payload: { declineReason: 'OTHER' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.undo).toBeTruthy();
    expect(body.undo.token).toEqual(expect.any(String));
    expect(body.undo.notReversible).toEqual([{ leadId: withCadence, reason: expect.stringContaining('cadence') }]);
  });

  it('omits undo entirely when nothing in the batch succeeded', async () => {
    const res = await PATCH(req({ brand: 'cogmap', leadIds: ['507f1f77bcf86cd799439011'], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.undo).toBeUndefined();
  });
});

describe('POST /api/leads/bulk/undo (issue #203)', () => {
  it('rejects a missing token', async () => {
    const res = await undoPOST(undoReq({ brand: 'cogmap' }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown token', async () => {
    const res = await undoPOST(undoReq({ brand: 'cogmap', token: 'not-a-real-token' }));
    expect(res.status).toBe(404);
  });

  it('404s when the token exists but belongs to a different brand (cross-tenant rejection)', async () => {
    const id = await seedLead('Undo Cross Brand Co');
    const patchRes = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    const patchBody = await patchRes.json();

    const res = await undoPOST(undoReq({ brand: 'dvsc', token: patchBody.undo.token }));
    expect(res.status).toBe(404);
  });

  it('restores status/kanbanColumn/declineReason and reverses the counters for a DECLINE undo', async () => {
    const id = await seedLead('Undo Happy Path Co');
    const patchRes = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    const patchBody = await patchRes.json();
    expect(patchBody.undo).toBeTruthy();

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    const declined = await client.db().collection('leads').findOne({ _id: new ObjectId(id) });
    expect(declined?.kanbanColumn).toBe('LOST');
    expect(declined?.declineCount).toBe(1);
    expect(declined?.feedbackScore).toBe(-1);

    const undoRes = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(undoRes.status).toBe(200);
    const undoBody = await undoRes.json();
    expect(undoBody.results).toEqual([{ leadId: id, success: true, error: undefined }]);
    expect(undoBody.skipped).toEqual([]);

    const restored = await client.db().collection('leads').findOne({ _id: new ObjectId(id) });
    expect(restored?.kanbanColumn).toBe('DISCOVERED');
    expect(restored?.status).not.toBe('lost');
    // Explicit counter reversal (issue #203 §15 "counter drift"), not just a
    // field restore — declineCount/feedbackScore go all the way back to 0.
    expect(restored?.declineCount).toBe(0);
    expect(restored?.feedbackScore).toBe(0);
  });

  it('is single-use — a second undo of the same token 404s', async () => {
    const id = await seedLead('Undo Single Use Co');
    const patchRes = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    const patchBody = await patchRes.json();

    const first = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(first.status).toBe(200);

    const second = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(second.status).toBe(404);
  });

  it('skips (does not overwrite) a lead whose state changed since the original action (CAS mismatch)', async () => {
    const id = await seedLead('Undo Cas Mismatch Co');
    const patchRes = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    const patchBody = await patchRes.json();

    // Something else moves the lead before the undo click lands.
    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const { ObjectId } = await import('mongodb');
    await client.db().collection('leads').updateOne({ _id: new ObjectId(id) }, { $set: { kanbanColumn: 'WON', status: 'won' } });

    const undoRes = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(undoRes.status).toBe(200);
    const undoBody = await undoRes.json();
    expect(undoBody.results).toEqual([]);
    expect(undoBody.skipped).toEqual([{ leadId: id, reason: expect.stringContaining('changed since') }]);

    // Never overwritten — the intervening WON move survives.
    const stillWon = await client.db().collection('leads').findOne({ _id: new ObjectId(id) });
    expect(stillWon?.kanbanColumn).toBe('WON');
  });

  it('410s for an expired token and leaves the lead untouched', async () => {
    const id = await seedLead('Undo Expired Co');
    const patchRes = await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));
    const patchBody = await patchRes.json();

    // Simulate expiry directly rather than waiting out the real window —
    // the application-level expiresAt check (not a real 15s sleep) is what
    // this asserts; the TTL index itself is checked separately below.
    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    await client.db().collection('bulkActionUndoTokens').updateOne(
      { token: patchBody.undo.token },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    const res = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(res.status).toBe(410);

    // A second attempt (post-expiry token already deleted by the 410 path
    // above) gets a clean 404, not a second 410.
    const second = await undoPOST(undoReq({ brand: 'cogmap', token: patchBody.undo.token }));
    expect(second.status).toBe(404);
  });

  it('creates the bulkActionUndoTokens TTL index on expiresAt (issue #203 §19 — the TTL mechanism itself, not just the application-level check)', async () => {
    const id = await seedLead('Undo Ttl Index Co');
    await PATCH(req({ brand: 'cogmap', leadIds: [id], action: 'DECLINE', payload: { declineReason: 'OTHER' } }));

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const indexes = await client.db().collection('bulkActionUndoTokens').indexes();
    const ttlIndex = indexes.find((idx: any) => idx.key?.expiresAt === 1);
    expect(ttlIndex).toBeTruthy();
    expect(ttlIndex?.expireAfterSeconds).toBe(0);
  });
});
