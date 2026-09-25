import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let rulesGET: typeof import('../../app/api/automation-rules/route').GET;
let rulesPOST: typeof import('../../app/api/automation-rules/route').POST;
let ruleGET: typeof import('../../app/api/automation-rules/[id]/route').GET;
let rulePUT: typeof import('../../app/api/automation-rules/[id]/route').PUT;
let ruleDELETE: typeof import('../../app/api/automation-rules/[id]/route').DELETE;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let leadsPATCH: typeof import('../../app/api/leads/route').PATCH;
let tickGET: typeof import('../../app/api/admin/automation-tick/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const rulesMod = await import('../../app/api/automation-rules/route');
  rulesGET = rulesMod.GET;
  rulesPOST = rulesMod.POST;
  const ruleMod = await import('../../app/api/automation-rules/[id]/route');
  ruleGET = ruleMod.GET;
  rulePUT = ruleMod.PUT;
  ruleDELETE = ruleMod.DELETE;
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  leadsPATCH = leadsMod.PATCH;
  tickGET = (await import('../../app/api/admin/automation-tick/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: Record<string, any>) {
  return buildApiRequest(url, init as any);
}

async function testDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

function leadPayload(entityName: string, overrides: Record<string, any> = {}) {
  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    entity_name: entityName,
    url: `https://${slug}.example.com`,
    country: 'US',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [{ name: 'Contact', email: `contact@${slug}.example.com`, isDecisionMaker: true }],
    ...overrides,
  };
}

async function createRule(brand: string, body: Record<string, any>) {
  const res = await rulesPOST(req(`/api/automation-rules?brand=${brand}&tenantId=default`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return res;
}

describe('GET/POST /api/automation-rules', () => {
  it('creates a rule defaulting enabled to false, and lists it', async () => {
    const createRes = await createRule('cogmap', {
      name: 'Tag new leads',
      trigger: { type: 'lead_created' },
      action: { type: 'apply_tag', tag: 'auto-tagged' },
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.enabled).toBe(false);

    const listRes = await rulesGET(req('/api/automation-rules?brand=cogmap&tenantId=default'));
    const listBody = await listRes.json();
    expect(listBody.rules.some((r: any) => r.id === created.id)).toBe(true);
  });

  it('rejects a rule with no valid action', async () => {
    const res = await createRule('cogmap', {
      name: 'Bad rule',
      trigger: { type: 'lead_created' },
      action: { type: 'not_a_real_action' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects an enabled lead_assigned rule (no assignment model to fire it from)', async () => {
    const res = await createRule('cogmap', {
      name: 'Assign notify',
      trigger: { type: 'lead_assigned' },
      action: { type: 'apply_tag', tag: 'x' },
      enabled: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT/DELETE /api/automation-rules/[id]', () => {
  it('updates a rule, then deletes it (404 on second delete)', async () => {
    const createRes = await createRule('cogmap', {
      name: 'Original name',
      trigger: { type: 'lead_created' },
      action: { type: 'apply_tag', tag: 'orig' },
    });
    const created = await createRes.json();

    const putRes = await rulePUT(
      req(`/api/automation-rules/${created.id}?brand=cogmap&tenantId=default`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', enabled: true }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.name).toBe('Renamed');
    expect(updated.enabled).toBe(true);

    const getRes = await ruleGET(req(`/api/automation-rules/${created.id}?tenantId=default`), { params: Promise.resolve({ id: created.id }) });
    expect(getRes.status).toBe(200);

    const deleteRes = await ruleDELETE(req(`/api/automation-rules/${created.id}?tenantId=default`, { method: 'DELETE' }), { params: Promise.resolve({ id: created.id }) });
    expect(deleteRes.status).toBe(200);

    const secondDelete = await ruleDELETE(req(`/api/automation-rules/${created.id}?tenantId=default`, { method: 'DELETE' }), { params: Promise.resolve({ id: created.id }) });
    expect(secondDelete.status).toBe(404);
  });
});

describe('Event-fired trigger: lead_created', () => {
  it('applies a tag to a newly-created lead when an enabled lead_created rule exists', async () => {
    await createRule('cogmap', {
      name: 'Tag on create',
      trigger: { type: 'lead_created' },
      action: { type: 'apply_tag', tag: 'freshly-created' },
      enabled: true,
    });

    const res = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Automation Created Co')),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lead.tags).toContain('freshly-created');
  });

  it('a disabled rule never fires', async () => {
    await createRule('cogmap', {
      name: 'Disabled create rule',
      trigger: { type: 'lead_created' },
      action: { type: 'apply_tag', tag: 'should-never-appear' },
      enabled: false,
    });

    const res = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Automation Disabled Rule Co')),
    }));
    const body = await res.json();
    expect(body.lead.tags || []).not.toContain('should-never-appear');
  });

  it('log_notification writes a system entry to activityLog', async () => {
    await createRule('cogmap', {
      name: 'Log on create',
      trigger: { type: 'lead_created' },
      action: { type: 'log_notification', message: 'New lead auto-flagged' },
      enabled: true,
    });

    const res = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Automation Log Co')),
    }));
    const body = await res.json();
    const db = await testDb();
    const entry = await db.collection('activityLog').findOne({ leadId: body.lead._id.toString(), type: 'system' });
    expect(entry).toBeTruthy();
    expect(entry?.bodyExcerpt).toBe('New lead auto-flagged');
    expect(entry?.source).toBe('manual');
  });
});

describe('Event-fired trigger: lead_moved_to_column', () => {
  function patchReq(id: string, body: Record<string, unknown>) {
    return req(`/api/leads?brand=cogmap&tenantId=default&id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
  }

  async function seedLead(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const db = await testDb();
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

  it('fires only after the move actually lands on the target column', async () => {
    await createRule('cogmap', {
      name: 'Tag on ENGAGED',
      trigger: { type: 'lead_moved_to_column', column: 'ENGAGED' },
      action: { type: 'apply_tag', tag: 'engaged-tagged' },
      enabled: true,
    });

    // Satisfies the ENGAGED stage gate (a contact + value_proposition).
    const id = await seedLead('Move To Engaged Co', {
      contacts: [{ name: 'Contact', isDecisionMaker: true }],
      value_proposition: 'Real value',
    });
    const res = await leadsPATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.tags).toContain('engaged-tagged');
  });

  it('a stage-gate-blocked move never fires the rule (issue 201 §8/§15)', async () => {
    await createRule('cogmap', {
      name: 'Tag on PROPOSAL',
      trigger: { type: 'lead_moved_to_column', column: 'PROPOSAL' },
      action: { type: 'apply_tag', tag: 'should-never-fire' },
      enabled: true,
    });

    // No contacts / value_proposition — PROPOSAL is gated, move must 400.
    const id = await seedLead('Blocked Move Co');
    const res = await leadsPATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'PROPOSAL', sortOrder: Date.now() }));
    expect(res.status).toBe(400);

    const db = await testDb();
    const { ObjectId } = await import('mongodb');
    const lead = await db.collection('leads').findOne({ _id: new ObjectId(id) });
    expect(lead?.tags || []).not.toContain('should-never-fire');
  });

  it('does not fire for a different destination column than the rule names', async () => {
    await createRule('cogmap', {
      name: 'Tag on WON only',
      trigger: { type: 'lead_moved_to_column', column: 'WON' },
      action: { type: 'apply_tag', tag: 'won-only-tag' },
      enabled: true,
    });

    const id = await seedLead('Wrong Column Co', {
      contacts: [{ name: 'Contact', isDecisionMaker: true }],
      value_proposition: 'Real value',
    });
    const res = await leadsPATCH(patchReq(id, { action: 'COLUMN_MOVE', kanbanColumn: 'ENGAGED', sortOrder: Date.now() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.tags || []).not.toContain('won-only-tag');
  });
});

describe('Tick-fired trigger: stale_no_activity via GET /api/admin/automation-tick', () => {
  it('applies the action to a stale lead and records lastEvaluatedAt/firingCount, without double-firing on a same-day re-run', async () => {
    const createRes = await createRule('cogmap', {
      name: 'Flag stale leads',
      trigger: { type: 'stale_no_activity', thresholdDays: 1 },
      action: { type: 'apply_tag', tag: 'stale-flagged' },
      enabled: true,
    });
    const rule = await createRes.json();

    const db = await testDb();
    const staleUpdatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const insertResult = await db.collection('leads').insertOne({
      entity_name: 'Stale Tick Co',
      tenantId: 'default',
      kanbanColumn: 'DISCOVERED',
      contacts: [],
      updatedAt: staleUpdatedAt,
    });

    const tickRes = await tickGET(req('/api/admin/automation-tick'));
    expect(tickRes.status).toBe(200);
    const tickBody = await tickRes.json();
    expect(tickBody.actionsApplied).toBeGreaterThanOrEqual(1);

    const { ObjectId } = await import('mongodb');
    const lead = await db.collection('leads').findOne({ _id: insertResult.insertedId });
    expect(lead?.tags).toContain('stale-flagged');

    const ruleAfter = await db.collection('automation_rules').findOne({ _id: new ObjectId(rule.id) });
    expect(ruleAfter?.lastEvaluatedAt).toBeTruthy();
    expect(ruleAfter?.firingCount).toBeGreaterThanOrEqual(1);
    const firingCountAfterFirstTick = ruleAfter?.firingCount;

    // Re-running the tick same day must not fire again for the same
    // (rule, lead) pair — issue #201 §15's own idempotency requirement.
    // apply_tag's own $addToSet is naturally idempotent regardless, so this
    // specifically asserts firingCount itself doesn't double-count.
    await tickGET(req('/api/admin/automation-tick'));
    const ruleAfterSecondTick = await db.collection('automation_rules').findOne({ _id: new ObjectId(rule.id) });
    expect(ruleAfterSecondTick?.firingCount).toBe(firingCountAfterFirstTick);
  });

  it('short-circuits (no candidate scan) for a brand with zero enabled stale_no_activity rules', async () => {
    const res = await tickGET(req('/api/admin/automation-tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.brandsScanned).toBe('number');
  });

  it('never touches a WON/LOST lead regardless of staleness', async () => {
    await createRule('cogmap', {
      name: 'Flag stale (WON exclusion check)',
      trigger: { type: 'stale_no_activity', thresholdDays: 1 },
      action: { type: 'apply_tag', tag: 'should-not-tag-won' },
      enabled: true,
    });

    const db = await testDb();
    const staleUpdatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const insertResult = await db.collection('leads').insertOne({
      entity_name: 'Stale WON Co',
      tenantId: 'default',
      kanbanColumn: 'WON',
      contacts: [],
      updatedAt: staleUpdatedAt,
    });

    await tickGET(req('/api/admin/automation-tick'));

    const lead = await db.collection('leads').findOne({ _id: insertResult.insertedId });
    expect(lead?.tags || []).not.toContain('should-not-tag-won');
  });
});
