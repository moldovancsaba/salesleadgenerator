import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import type { NextRequest } from 'next/server';

// PATCH /api/leads (the ACCEPT/DECLINE/PIN/COLUMN_MOVE/etc. action handler)
// had zero integration coverage before this — added while investigating
// issue #91 ("move to column doesn't work"), whose real root cause turned
// out to be here: this route required requireApiKey, but the browser (every
// caller — app/kanban.tsx, app/detail.tsx via app/sales/[brand]/sales-page-
// client.tsx's handleAction) has never sent an x-api-key header. Fixed at
// the time by removing the guard entirely (same "browser can't hold this
// secret safely" precedent as PUT /api/sales-settings/[brand]) — which
// issue #104 later found had gone too far: it left this route (and DELETE
// /api/leads/[id] below) with no auth at all, so per-org access control
// never actually applied to the data these buttons write. Both routes are
// now gated by requireBrandAccessApi (lib/require-brand-access-api.ts),
// which accepts either a session with brand access (the real browser path)
// or an x-api-key (what these tests use, via helpers/api-request.ts, since
// minting a real signed SSO JWT isn't possible in this sandbox).
//
// Seeds leads by inserting directly via the driver rather than through
// POST /api/leads — POST's own quality-gate check (computeEase(), a
// pre-existing feature unrelated to this fix) rejects the minimal ICE
// fixtures used elsewhere in this test suite, a separate, already-disclosed
// gap (see docs/STACK_AND_DEPENDENCIES.md's Known Issues) not fixed here.

let mongod: MongoMemoryServer;
let PATCH: typeof import('../../app/api/leads/route').PATCH;
let GET: typeof import('../../app/api/leads/route').GET;
let idDELETE: typeof import('../../app/api/leads/[id]/route').DELETE;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/leads/route');
  PATCH = mod.PATCH;
  GET = mod.GET;
  idDELETE = (await import('../../app/api/leads/[id]/route')).DELETE;
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

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

function patchReq(id: string, body: Record<string, unknown>) {
  return req(`/api/leads?brand=cogmap&tenantId=default&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...body }),
  });
}

describe('PATCH /api/leads — action succeeds with valid credentials (issue #91/#104)', () => {
  it('succeeds with a valid credential and no browser session, matching the machine-caller path requireBrandAccessApi supports', async () => {
    const id = await seedLead('No Auth Header Co');
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
  });

  it('rejects a completely malformed request the same as before (bad column) — auth passing doesn\'t skip validation', async () => {
    const id = await seedLead('Bad Column Co');
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'NOT_A_REAL_COLUMN' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/leads — COLUMN_MOVE (issue #91)', () => {
  it('moves a lead to the requested column and it is reflected on a subsequent GET', async () => {
    const id = await seedLead('Move Target Co');
    const patchRes = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: Date.now() }));
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.lead.kanbanColumn).toBe('QUALIFIED');

    const listRes = await GET(req('/api/leads?brand=cogmap'));
    const listBody = await listRes.json();
    const moved = listBody.leads.find((l: any) => l._id === id);
    expect(moved.kanbanColumn).toBe('QUALIFIED');
  });

  it('a same-column move is accepted as a no-op-shaped success (matches app/kanban.tsx short-circuiting before ever calling this route)', async () => {
    // ENGAGED is gated (issue #72) — seeded with the required fields so this
    // test exercises same-column-move behavior, not the unrelated stage gate.
    const id = await seedLead('Same Column Co', {
      kanbanColumn: 'ENGAGED',
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/leads — ACCEPT/DECLINE (issue #90/#91 investigation)', () => {
  it('ACCEPT sets status=qualified and increments acceptanceCount/feedbackScore', async () => {
    const id = await seedLead('Accept Me Co');
    const res = await PATCH(patchReq(id, { action: 'ACCEPT', annotation: 'Accepted' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.status).toBe('qualified');
    expect(body.lead.acceptanceCount).toBe(1);
    expect(body.lead.feedbackScore).toBe(1);
  });

  it('DECLINE moves a lead to LOST and records the reason', async () => {
    const id = await seedLead('Decline Me Co');
    const res = await PATCH(patchReq(id, { action: 'DECLINE', declineReason: 'BUDGET_CONSTRAINTS', annotation: 'Too small' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('LOST');
    expect(body.lead.declineReason).toBe('BUDGET_CONSTRAINTS');
  });
});

describe('PATCH /api/leads — required-fields-per-stage gating (issue #72)', () => {
  it('blocks a COLUMN_MOVE into ENGAGED when required fields are missing, with a clear message', async () => {
    const id = await seedLead('No Contact Co');
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing required fields for ENGAGED: a decision-maker contact, a value proposition');
  });

  it('blocks a PIN (always targets ENGAGED) when required fields are missing', async () => {
    const id = await seedLead('Pin Blocked Co');
    const res = await PATCH(patchReq(id, { action: 'PIN' }));
    expect(res.status).toBe(400);
  });

  it('allows a COLUMN_MOVE into ENGAGED when required fields are present on the existing lead', async () => {
    const id = await seedLead('Ready For Engaged Co', {
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
  });

  it('allows a COLUMN_MOVE into ENGAGED when the required fields are supplied in the same request payload', async () => {
    const id = await seedLead('Same Request Co');
    const res = await PATCH(patchReq(id, {
      action: 'COLUMN_MOVE',
      kanbanColumn: 'ENGAGED',
      sortOrder: Date.now(),
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    }));
    expect(res.status).toBe(200);
  });

  it('does not gate a COLUMN_MOVE into DISCOVERED/QUALIFIED (auto-managed columns)', async () => {
    const id = await seedLead('Discovered Co');
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
  });

  it('does not gate a DECLINE into LOST', async () => {
    const id = await seedLead('Decline No Gate Co');
    const res = await PATCH(patchReq(id, { action: 'DECLINE', declineReason: 'OTHER' }));
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/leads/[id] — action succeeds with valid credentials (issue #91/#104)', () => {
  it('succeeds with a valid credential and no browser session, matching the machine-caller path requireBrandAccessApi supports', async () => {
    const id = await seedLead('No Auth Delete Co');
    const res = await idDELETE(
      req(`/api/leads/${id}?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
  });
});
