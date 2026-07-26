import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// PATCH /api/leads/bulk (issue #70) — reuses executeLeadAction per lead, so
// most business-logic edge cases are already covered by
// leads-patch-actions.integration.test.ts; this file focuses on what's new
// here: partial failure reporting and the request-size cap.

let mongod: MongoMemoryServer;
let PATCH: typeof import('../../app/api/leads/bulk/route').PATCH;

beforeAll(async () => {
  mongod = await startTestMongo();
  PATCH = (await import('../../app/api/leads/bulk/route')).PATCH;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

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
  return new Request('http://localhost/api/leads/bulk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/leads/bulk', () => {
  it('rejects an unsupported action', async () => {
    const res = await PATCH(req({ brand: 'cogmap', leadIds: ['x'], action: 'ACCEPT' }));
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
