import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import type { NextRequest } from 'next/server';

// PATCH /api/leads with action: 'COLUMN_REORDER' (issue #208) — same-column
// drag reorder for the five manually-controlled columns. Exercises the real
// route -> executeLeadAction() path, same auth/seeding conventions as
// leads-patch-actions.integration.test.ts.

let mongod: MongoMemoryServer;
let PATCH: typeof import('../../app/api/leads/route').PATCH;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/leads/route');
  PATCH = mod.PATCH;
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
    kanbanColumn: 'ENGAGED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

async function getLead(id: string): Promise<any> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const { ObjectId } = await import('mongodb');
  return db.collection('leads').findOne({ _id: new ObjectId(id) });
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

function patchReq(id: string, body: Record<string, unknown>) {
  return req(`/api/leads?brand=cogmap&tenantId=default&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'COLUMN_REORDER', ...body }),
  });
}

describe('PATCH /api/leads — COLUMN_REORDER (issue #208)', () => {
  it('reorders a lead between two existing neighbors and persists a sortOrder strictly between them', async () => {
    const topId = await seedLead('Top Lead Co', { sortOrder: 2000 });
    const bottomId = await seedLead('Bottom Lead Co', { sortOrder: 1000 });
    const movedId = await seedLead('Moved Lead Co', { sortOrder: 3000 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: topId, nextLeadId: bottomId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.sortOrder).toBeGreaterThan(1000);
    expect(body.lead.sortOrder).toBeLessThan(2000);
    // kanbanColumn and manualLane* fields must be untouched by a reorder.
    expect(body.lead.kanbanColumn).toBe('ENGAGED');
  });

  it('dropping at the very top sorts above the current top item', async () => {
    const topId = await seedLead('Current Top Co', { sortOrder: 5000 });
    const movedId = await seedLead('New Top Co', { sortOrder: 1 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: null, nextLeadId: topId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.sortOrder).toBeGreaterThan(5000);
  });

  it('dropping at the very bottom sorts below the current bottom item', async () => {
    const bottomId = await seedLead('Current Bottom Co', { sortOrder: 500 });
    const movedId = await seedLead('New Bottom Co', { sortOrder: 9000 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: bottomId, nextLeadId: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.sortOrder).toBeLessThan(500);
  });

  it('rejects a reorder attempt on an auto-managed column (DISCOVERED)', async () => {
    const id = await seedLead('Auto Managed Reorder Co', { kanbanColumn: 'DISCOVERED', sortOrder: 100 });
    const res = await PATCH(patchReq(id, { prevLeadId: null, nextLeadId: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('This column is sorted automatically by lead score');
  });

  it('rejects a reorder attempt on an auto-managed column (QUALIFIED)', async () => {
    const id = await seedLead('Qualified Reorder Co', { kanbanColumn: 'QUALIFIED', sortOrder: 100 });
    const res = await PATCH(patchReq(id, { prevLeadId: null, nextLeadId: null }));
    expect(res.status).toBe(400);
  });

  it('treats a prevLeadId/nextLeadId from a different tenant as absent, falling back to the boundary case rather than leaking or erroring', async () => {
    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const foreignResult = await db.collection('leads').insertOne({
      entity_name: 'Foreign Tenant Co', tenantId: 'a-different-tenant', kanbanColumn: 'ENGAGED', sortOrder: 999999, contacts: [],
    });
    const foreignId = foreignResult.insertedId.toString();

    const movedId = await seedLead('Cross Tenant Reorder Co', { sortOrder: 42 });
    const res = await PATCH(patchReq(movedId, { prevLeadId: foreignId, nextLeadId: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // foreignId resolved to nothing (wrong tenant) -> treated as prevLeadId:
    // null alongside a real nextLeadId: null -> both-null "only item" case.
    expect(typeof body.lead.sortOrder).toBe('number');
  });

  it('treats a prevLeadId belonging to a different column as absent (stale drag-start reference)', async () => {
    const otherColumnId = await seedLead('Wrong Column Co', { kanbanColumn: 'PROPOSAL', sortOrder: 777 });
    const bottomId = await seedLead('Real Neighbor Co', { sortOrder: 100 });
    const movedId = await seedLead('Stale Prev Ref Co', { sortOrder: 5 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: otherColumnId, nextLeadId: bottomId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // otherColumnId is in PROPOSAL, not this lead's ENGAGED column -> treated
    // as prevSortOrder: null -> "dropped at the very top" relative to bottomId.
    expect(body.lead.sortOrder).toBeGreaterThan(100);
  });

  it('falls back to NEEDS_RESEQUENCE and resequences the whole column when neighbors are too close to bisect further', async () => {
    const topId = await seedLead('Resequence Top Co', { sortOrder: 1000 + 1e-10 });
    const bottomId = await seedLead('Resequence Bottom Co', { sortOrder: 1000 });
    const movedId = await seedLead('Resequence Moved Co', { sortOrder: 50000 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: topId, nextLeadId: bottomId }));
    expect(res.status).toBe(200);
    const body = await res.json();

    const top = await getLead(topId);
    const bottom = await getLead(bottomId);
    const moved = await getLead(movedId);

    // Resequenced: the moved lead lands strictly between its two real
    // neighbors' NEW, well-spaced sortOrder values.
    expect(moved!.sortOrder).toBe(body.lead.sortOrder);
    expect(top!.sortOrder).toBeGreaterThan(moved!.sortOrder);
    expect(moved!.sortOrder).toBeGreaterThan(bottom!.sortOrder);
    // Well-spaced (not sub-epsilon) after resequencing.
    expect(top!.sortOrder - moved!.sortOrder).toBeGreaterThan(1);
    expect(moved!.sortOrder - bottom!.sortOrder).toBeGreaterThan(1);
  });

  it('records a real outcomelogs entry for the reorder', async () => {
    const topId = await seedLead('Log Top Co', { sortOrder: 2000 });
    const movedId = await seedLead('Log Moved Co', { sortOrder: 1 });

    const res = await PATCH(patchReq(movedId, { prevLeadId: null, nextLeadId: topId }));
    expect(res.status).toBe(200);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const logEntry = await db.collection('outcomelogs').findOne({ leadId: movedId, action: 'COLUMN_REORDER' });
    expect(logEntry).toBeTruthy();
    expect(logEntry!.outcomeValue).toBe('Reordered within ENGAGED');
  });

  it('a bare-null-both reorder (the only lead in the column) still succeeds', async () => {
    const id = await seedLead('Only Lead In Column Co', { sortOrder: 123 });
    const res = await PATCH(patchReq(id, { prevLeadId: null, nextLeadId: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.lead.sortOrder).toBe('number');
  });
});
