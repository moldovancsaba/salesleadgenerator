import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #124/#151: the daily cadence-tick scheduler. sendAutomatedEmail()
// itself already has full, independent coverage against a mocked Resend
// (tests/integration/outreach-send.integration.test.ts) — mocked here at
// the module boundary instead, matching the issue's own Testing
// Requirements ("integration tests ... with a mocked sendAutomatedEmail"),
// so this file can focus purely on the tick's own decision logic: which
// leads are due, email-vs-reminder branching, step advancement/completion,
// the per-tick cap, and the disabled/missing-cadence edge cases.
const sendAutomatedEmailMock = vi.fn();
vi.mock('../../lib/outreach-send', () => ({
  sendAutomatedEmail: (...args: any[]) => sendAutomatedEmailMock(...args),
}));

let mongod: MongoMemoryServer;
let tickGET: typeof import('../../app/api/admin/cadence-tick/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/admin/cadence-tick/route');
  tickGET = mod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  sendAutomatedEmailMock.mockReset();
  sendAutomatedEmailMock.mockResolvedValue({ sent: true, outreachLogId: 'log-mock-1' });
});

function req(url: string) {
  return buildApiRequest(url);
}

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function createCadence(brand: string, steps: any[], enabled = true, name = 'Test Cadence') {
  const database = await db();
  const now = new Date();
  const result = await database.collection('cadences').insertOne({
    tenantId: 'default',
    brand,
    name,
    steps,
    enabled,
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId.toString();
}

async function seedLead(
  collection: string,
  entityName: string,
  activeCadence: { cadenceId: string; currentStepIndex: number; stepDueAt: string; enrolledAt: string } | null,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const database = await db();
  const result = await database.collection(collection).insertOne({
    entity_name: entityName,
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [{ name: 'Jamie Rivera', email: 'jamie@example.com', isDecisionMaker: true }],
    activeCadence,
    ...overrides,
  });
  return result.insertedId.toString();
}

function dueNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function getLead(collection: string, id: string) {
  const { ObjectId } = await import('mongodb');
  const database = await db();
  return database.collection(collection).findOne({ _id: new ObjectId(id) });
}

describe('GET /api/admin/cadence-tick — email step (issue #151)', () => {
  it('calls sendAutomatedEmail for a due email step and advances to the next step on success', async () => {
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' },
      { id: 's2', channel: 'call', waitDaysAfterPrevious: 3 },
    ]);
    const leadId = await seedLead('leads', 'Email Step Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.emailsSent).toBe(1);
    expect(sendAutomatedEmailMock).toHaveBeenCalledTimes(1);
    const [, , , context] = sendAutomatedEmailMock.mock.calls[0];
    expect(context).toMatchObject({ brand: 'cogmap', tenantId: 'default', cadenceId, stepIndex: 0 });

    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence.currentStepIndex).toBe(1);
    expect(lead?.activeCadence.cadenceId).toBe(cadenceId);
  });

  it('still advances the step when sendAutomatedEmail reports a failure (no retry-within-tick)', async () => {
    sendAutomatedEmailMock.mockResolvedValue({ sent: false, reason: 'Missing decision maker email for email outreach.', outreachLogId: 'log-x' });
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' },
      { id: 's2', channel: 'call', waitDaysAfterPrevious: 2 },
    ]);
    const leadId = await seedLead('leads', 'Failed Send Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.emailsSent).toBe(0);
    expect(body.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ leadId, reason: 'Missing decision maker email for email outreach.' })])
    );
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence.currentStepIndex).toBe(1);
  });

  it('completing the last step clears activeCadence and counts as cadencesCompleted', async () => {
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' },
    ]);
    const leadId = await seedLead('leads', 'Last Step Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.cadencesCompleted).toBe(1);
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence).toBeNull();
  });
});

describe('GET /api/admin/cadence-tick — linkedin/call reminder step (issue #151)', () => {
  it('never calls sendAutomatedEmail for a linkedin step, and sets nextActionDueAt/nextActionNote instead', async () => {
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'linkedin', waitDaysAfterPrevious: 0, reminderNote: 'Send a personalized connection request' },
      { id: 's2', channel: 'call', waitDaysAfterPrevious: 3 },
    ]);
    const leadId = await seedLead('leads', 'LinkedIn Step Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.remindersSet).toBe(1);
    expect(body.emailsSent).toBe(0);
    expect(sendAutomatedEmailMock).not.toHaveBeenCalled();

    const lead = await getLead('leads', leadId);
    expect(lead?.nextActionNote).toBe('Send a personalized connection request');
    expect(lead?.nextActionDueAt).toBeTruthy();
    expect(lead?.activeCadence.currentStepIndex).toBe(1);
  });

  it('a call step with no custom reminderNote gets the default note', async () => {
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'call', waitDaysAfterPrevious: 0 },
      { id: 's2', channel: 'email', waitDaysAfterPrevious: 2, templateId: 'tpl-1' },
    ]);
    const leadId = await seedLead('leads', 'Default Note Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    await tickGET(req('/api/admin/cadence-tick'));

    const lead = await getLead('leads', leadId);
    expect(lead?.nextActionNote).toBe('Call due (cadence)');
  });
});

describe('GET /api/admin/cadence-tick — leads not yet due are untouched (issue #151)', () => {
  it('skips a lead whose stepDueAt is in the future', async () => {
    const cadenceId = await createCadence('cogmap', [{ id: 's1', channel: 'call', waitDaysAfterPrevious: 0 }]);
    const leadId = await seedLead('leads', 'Not Due Yet Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(24 * 60 * 60 * 1000), enrolledAt: dueNow(),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.processed).toBe(0);
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence.currentStepIndex).toBe(0);
    expect(lead?.nextActionNote).toBeUndefined();
  });
});

describe('GET /api/admin/cadence-tick — disabled/missing cadence (issue #151)', () => {
  it('clears activeCadence for a due lead on a disabled cadence, without sending', async () => {
    const cadenceId = await createCadence('cogmap', [{ id: 's1', channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' }], false);
    const leadId = await seedLead('leads', 'Disabled Cadence Co', {
      cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(sendAutomatedEmailMock).not.toHaveBeenCalled();
    expect(body.failures).toEqual(expect.arrayContaining([expect.objectContaining({ leadId, reason: 'cadence disabled' })]));
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence).toBeNull();
  });

  it('clears activeCadence for a lead whose cadence template was deleted', async () => {
    const { ObjectId } = await import('mongodb');
    const deletedCadenceId = new ObjectId().toString();
    const leadId = await seedLead('leads', 'Deleted Template Co', {
      cadenceId: deletedCadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ leadId, reason: 'cadence template not found' })])
    );
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence).toBeNull();
  });

  it('clears activeCadence when currentStepIndex is past the end of the steps array', async () => {
    const cadenceId = await createCadence('cogmap', [{ id: 's1', channel: 'call', waitDaysAfterPrevious: 0 }]);
    const leadId = await seedLead('leads', 'Out Of Range Co', {
      cadenceId, currentStepIndex: 5, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ leadId, reason: 'step index out of range' })])
    );
    const lead = await getLead('leads', leadId);
    expect(lead?.activeCadence).toBeNull();
  });
});

describe('GET /api/admin/cadence-tick — multi-brand (issue #151)', () => {
  it('processes due leads independently across brands', async () => {
    const cogmapCadenceId = await createCadence('cogmap', [{ id: 's1', channel: 'call', waitDaysAfterPrevious: 0 }]);
    const seyuCadenceId = await createCadence('seyu', [{ id: 's1', channel: 'call', waitDaysAfterPrevious: 0 }]);
    const cogmapLeadId = await seedLead('leads', 'CogMap Due Co', {
      cadenceId: cogmapCadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });
    const seyuLeadId = await seedLead('seyu_leads', 'Seyu Due Co', {
      cadenceId: seyuCadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000), enrolledAt: dueNow(-1000),
    });

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.processed).toBe(2);
    expect(body.remindersSet).toBe(2);
    const cogmapLead = await getLead('leads', cogmapLeadId);
    const seyuLead = await getLead('seyu_leads', seyuLeadId);
    expect(cogmapLead?.activeCadence).toBeNull();
    expect(seyuLead?.activeCadence).toBeNull();
  });
});

describe('GET /api/admin/cadence-tick — per-tick cap (issue #151)', () => {
  it('caps processing at 200 leads per brand per run, leaving the rest for the next tick', async () => {
    const cadenceId = await createCadence('cogmap', [
      { id: 's1', channel: 'call', waitDaysAfterPrevious: 0 },
      { id: 's2', channel: 'call', waitDaysAfterPrevious: 1 },
    ]);
    const TOTAL = 205;
    const leadIds: string[] = [];
    for (let i = 0; i < TOTAL; i++) {
      // Distinct stepDueAt per lead (older first) so the cap's oldest-due-first
      // ordering is unambiguous — ties would make "which 5 were left" arbitrary.
      const id = await seedLead('leads', `Cap Test Co ${i}`, {
        cadenceId, currentStepIndex: 0, stepDueAt: dueNow(-1000 - (TOTAL - i)), enrolledAt: dueNow(-1000),
      });
      leadIds.push(id);
    }

    const res = await tickGET(req('/api/admin/cadence-tick'));
    const body = await res.json();

    expect(body.processed).toBe(200);

    const { ObjectId } = await import('mongodb');
    const database = await db();
    const stillDueCount = await database.collection('leads').countDocuments({
      _id: { $in: leadIds.map((id) => new ObjectId(id)) },
      'activeCadence.currentStepIndex': 0,
    });
    expect(stillDueCount).toBe(5);
  }, 30000);
});
