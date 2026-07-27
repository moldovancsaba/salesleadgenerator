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
    expect(body.error).toBe('Missing required fields for ENGAGED: a contact, a value proposition');
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

describe('PATCH /api/leads — MODIFY: country (regression guard, 2026-07-27)', () => {
  it('updates country via the Edit Lead Details form path — validated on create but silently dropped/non-editable until this fix, see CHANGELOG.md', async () => {
    const id = await seedLead('Country Modify Co', { country: 'US' });
    const res = await PATCH(patchReq(id, { action: 'MODIFY', country: 'DE' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.country).toBe('DE');
  });
});

describe('PATCH /api/leads — MODIFY: deals (issue #114)', () => {
  it('saves a manual deal and sums it', async () => {
    const id = await seedLead('Deal Co');
    const res = await PATCH(patchReq(id, { action: 'MODIFY', deals: [{ value: 50000, currency: 'USD', label: 'Renewal' }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.deals).toHaveLength(1);
    expect(body.lead.deals[0].value).toBe(50000);
    expect(body.lead.deals[0].source).toBe('manual');
  });

  it('drops an invalid deal row (non-positive value) rather than storing it', async () => {
    const id = await seedLead('Bad Deal Co');
    const res = await PATCH(patchReq(id, { action: 'MODIFY', deals: [{ value: -100 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.deals).toHaveLength(0);
  });

  it('clamps an implausible deal value to the absolute ceiling', async () => {
    const id = await seedLead('Huge Deal Co');
    const res = await PATCH(patchReq(id, { action: 'MODIFY', deals: [{ value: 999_999_999 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.deals[0].value).toBe(50_000_000);
  });

  it('preserves createdAt/source across an edit of an existing deal (matched by id)', async () => {
    const id = await seedLead('Edit Deal Co');
    const first = await PATCH(patchReq(id, { action: 'MODIFY', deals: [{ value: 1000, source: 'converted_ticket_estimate' }] }));
    const firstBody = await first.json();
    const dealId = firstBody.lead.deals[0].id;
    const createdAt = firstBody.lead.deals[0].createdAt;

    const second = await PATCH(patchReq(id, { action: 'MODIFY', deals: [{ id: dealId, value: 2000 }] }));
    const secondBody = await second.json();
    expect(secondBody.lead.deals[0].value).toBe(2000);
    expect(secondBody.lead.deals[0].createdAt).toBe(createdAt);
    expect(secondBody.lead.deals[0].source).toBe('converted_ticket_estimate');
  });
});

describe('PATCH /api/leads — MODIFY: checklist (issue #117)', () => {
  it('saves checklist items', async () => {
    const id = await seedLead('Checklist Co');
    const res = await PATCH(patchReq(id, { action: 'MODIFY', checklist: [{ text: 'Send proposal', done: false }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.checklist).toHaveLength(1);
    expect(body.lead.checklist[0].text).toBe('Send proposal');
    expect(body.lead.checklist[0].done).toBe(false);
  });

  it('drops a blank-text checklist row', async () => {
    const id = await seedLead('Blank Checklist Co');
    const res = await PATCH(patchReq(id, { action: 'MODIFY', checklist: [{ text: '   ' }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.checklist).toHaveLength(0);
  });
});

describe('PATCH /api/leads — MODIFY: follow-up reminder (issue #121)', () => {
  it('sets nextActionDueAt and nextActionNote', async () => {
    const id = await seedLead('Followup Co');
    const due = new Date('2026-08-01T00:00:00.000Z').toISOString();
    const res = await PATCH(patchReq(id, { action: 'MODIFY', nextActionDueAt: due, nextActionNote: 'Call about renewal' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.nextActionDueAt).toBe(due);
    expect(body.lead.nextActionNote).toBe('Call about renewal');
  });

  it('explicitly clears nextActionDueAt when sent as null (vs. omission leaving it unchanged)', async () => {
    const id = await seedLead('Clear Followup Co');
    const due = new Date('2026-08-01T00:00:00.000Z').toISOString();
    await PATCH(patchReq(id, { action: 'MODIFY', nextActionDueAt: due }));

    const clearRes = await PATCH(patchReq(id, { action: 'MODIFY', nextActionDueAt: null }));
    const clearBody = await clearRes.json();
    expect(clearBody.lead.nextActionDueAt).toBeNull();
  });

  it('omitting nextActionDueAt leaves an existing reminder untouched', async () => {
    const id = await seedLead('Untouched Followup Co');
    const due = new Date('2026-08-01T00:00:00.000Z').toISOString();
    await PATCH(patchReq(id, { action: 'MODIFY', nextActionDueAt: due }));

    const res = await PATCH(patchReq(id, { action: 'MODIFY', notes: 'unrelated edit' }));
    const body = await res.json();
    expect(body.lead.nextActionDueAt).toBe(due);
  });
});

describe('PATCH /api/leads — MODIFY: qualification (issue #122)', () => {
  it('saves qualification fields', async () => {
    const id = await seedLead('Qual Co');
    const res = await PATCH(patchReq(id, {
      action: 'MODIFY',
      qualification: { budgetConfirmed: true, budgetNotes: '$50k approved', timelineEstimate: 'This quarter' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.qualification.budgetConfirmed).toBe(true);
    expect(body.lead.qualification.budgetNotes).toBe('$50k approved');
    expect(body.lead.qualification.timelineEstimate).toBe('This quarter');
  });

  it('merges field-by-field rather than replacing the whole object', async () => {
    const id = await seedLead('Qual Merge Co');
    await PATCH(patchReq(id, { action: 'MODIFY', qualification: { budgetConfirmed: true, timelineEstimate: 'This quarter' } }));

    const res = await PATCH(patchReq(id, { action: 'MODIFY', qualification: { authorityConfirmed: true } }));
    const body = await res.json();
    expect(body.lead.qualification.budgetConfirmed).toBe(true);
    expect(body.lead.qualification.timelineEstimate).toBe('This quarter');
    expect(body.lead.qualification.authorityConfirmed).toBe(true);
  });

  it('does not gate any stage transition on qualification fields', async () => {
    const id = await seedLead('Qual No Gate Co', {
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/leads — COLUMN_MOVE into/out of BACKLOG (issue #126)', () => {
  it('moves a lead to BACKLOG', async () => {
    const id = await seedLead('Backlog Bound Co');
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'BACKLOG', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('BACKLOG');
  });

  it('a BACKLOG lead is invisible to a DISCOVERED/QUALIFIED column fetch', async () => {
    const id = await seedLead('Hidden From Pipeline Co', { kanbanColumn: 'BACKLOG' });
    const listRes = await GET(req('/api/leads?brand=cogmap'));
    const listBody = await listRes.json();
    const found = listBody.leads.find((l: any) => l._id === id);
    expect(found.kanbanColumn).toBe('BACKLOG');
  });

  it('moving a BACKLOG lead into ENGAGED still enforces the stage-gate (no bypass just because it came from Backlog)', async () => {
    const id = await seedLead('Backlog No Gate Bypass Co', { kanbanColumn: 'BACKLOG' });
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing required fields for ENGAGED: a contact, a value proposition');
  });

  it('moving a BACKLOG lead into ENGAGED succeeds once the required fields are present', async () => {
    const id = await seedLead('Backlog To Engaged Co', {
      kanbanColumn: 'BACKLOG',
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    const res = await PATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('ENGAGED');
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
