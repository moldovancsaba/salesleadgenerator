import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { ACTIVITY_LOG_COLLECTION } from '../../app/lib/activity-log-store';

let mongod: MongoMemoryServer;
let database: Db;
let getTodayViewData: typeof import('../../lib/today-query').getTodayViewData;
let todayGET: typeof import('../../app/api/today/[brand]/route').GET;
let snoozePOST: typeof import('../../app/api/leads/[id]/snooze/route').POST;
let actionDonePOST: typeof import('../../app/api/leads/[id]/action-done/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  database = client.db();

  const queryMod = await import('../../lib/today-query');
  getTodayViewData = queryMod.getTodayViewData;
  const todayRouteMod = await import('../../app/api/today/[brand]/route');
  todayGET = todayRouteMod.GET;
  const snoozeRouteMod = await import('../../app/api/leads/[id]/snooze/route');
  snoozePOST = snoozeRouteMod.POST;
  const actionDoneRouteMod = await import('../../app/api/leads/[id]/action-done/route');
  actionDonePOST = actionDoneRouteMod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

describe('CRM Today Execution Queue Integration Tests', () => {
  const brand = 'cogmap';
  const collectionName = 'leads';
  const tenantId = 'default';

  it('aggregates cadence tasks, overdue follow-ups, due today follow-ups, and deals needing attention', async () => {
    const fixedNow = new Date('2026-10-13T12:00:00.000Z');

    // 1. Cadence task
    const leadCadence = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Cadence Prospect Ltd',
      contacts: [{ name: 'Alice Smith', email: 'alice@cadenceprospect.com' }],
      activeCadence: {
        cadenceId: 'cad_1',
        cadenceName: 'Outbound Alpha',
        currentStepIndex: 1,
        totalSteps: 3,
        stepChannel: 'call',
        waitingForTask: true,
        taskDueAt: '2026-10-13T09:00:00.000Z',
        reminderNote: 'Call Alice to qualify need',
      },
      updatedAt: fixedNow,
    };

    // 2. Overdue follow-up (3 days past)
    const leadOverdue = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Overdue Tech Corp',
      contacts: [{ name: 'Bob Jones', email: 'bob@overduetech.com' }],
      nextActionDueAt: '2026-10-10T10:00:00.000Z',
      nextActionNote: 'Review revised security pricing',
      updatedAt: fixedNow,
    };

    // 3. Due today follow-up
    const leadDueToday = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Due Today Global',
      contacts: [{ name: 'Charlie Brown', email: 'charlie@duetoday.com' }],
      nextActionDueAt: '2026-10-13T16:00:00.000Z',
      nextActionNote: 'Send updated proposal slides',
      updatedAt: fixedNow,
    };

    // 4. Deal past expected close date
    const leadPastClose = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Expired Close Deal Inc',
      kanbanColumn: 'PROPOSAL',
      deals: [
        {
          id: 'deal_101',
          label: 'Q3 Enterprise Expansion',
          value: 75000,
          expectedCloseDate: '2026-10-05',
          updatedAt: '2026-10-05T00:00:00.000Z',
        },
      ],
      updatedAt: fixedNow,
    };

    // 5. Stale deal inactive 12 days
    const leadStale = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Stale Opportunity LLC',
      kanbanColumn: 'ENGAGED',
      deals: [
        {
          id: 'deal_102',
          label: 'Mid-market Pilot',
          value: 20000,
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };

    // 6. Closed WON lead — must be excluded from attention
    const leadWon = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Already Won Partner',
      kanbanColumn: 'WON',
      deals: [
        {
          id: 'deal_103',
          label: 'Completed Deal',
          value: 100000,
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      updatedAt: fixedNow,
    };

    await database.collection(collectionName).deleteMany({});
    await database.collection(collectionName).insertMany([
      leadCadence,
      leadOverdue,
      leadDueToday,
      leadPastClose,
      leadStale,
      leadWon,
    ]);

    const result = await getTodayViewData(database, brand, {
      now: fixedNow,
      timezone: 'UTC',
      tenantId,
      scope: 'all',
    });

    expect(result.counts.cadenceTasks).toBe(1);
    expect(result.cadenceTasks[0].entityName).toBe('Cadence Prospect Ltd');
    expect(result.cadenceTasks[0].channel).toBe('call');
    expect(result.cadenceTasks[0].contactKey).toBe('alice smith|alice@cadenceprospect.com');

    expect(result.counts.overdueFollowUps).toBe(1);
    expect(result.overdueFollowUps[0].entityName).toBe('Overdue Tech Corp');
    expect(result.overdueFollowUps[0].overdueDays).toBe(3);

    expect(result.counts.dueTodayFollowUps).toBe(1);
    expect(result.dueTodayFollowUps[0].entityName).toBe('Due Today Global');
    expect(result.dueTodayFollowUps[0].overdueDays).toBe(0);

    expect(result.counts.dealsNeedingAttention).toBe(2);
    const pastCloseDeal = result.dealsNeedingAttention.find((d) => d.dealId === 'deal_101');
    const staleDeal = result.dealsNeedingAttention.find((d) => d.dealId === 'deal_102');
    expect(pastCloseDeal?.reason).toBe('past_close_date');
    expect(staleDeal?.reason).toBe('stale_stage');

    expect(result.counts.total).toBe(5);
  });

  it('filters by rep ownership when scope is "mine"', async () => {
    const fixedNow = new Date('2026-10-13T12:00:00.000Z');

    const leadMine = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'My Assigned Lead',
      assignedTo: 'rep_1',
      nextActionDueAt: '2026-10-13T14:00:00.000Z',
      updatedAt: fixedNow,
    };

    const leadOther = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Other Rep Lead',
      assignedTo: 'rep_2',
      nextActionDueAt: '2026-10-13T15:00:00.000Z',
      updatedAt: fixedNow,
    };

    const leadUnassigned = {
      _id: new ObjectId(),
      tenantId,
      entity_name: 'Unassigned Queue Item',
      assignedTo: null,
      nextActionDueAt: '2026-10-13T16:00:00.000Z',
      updatedAt: fixedNow,
    };

    await database.collection(collectionName).deleteMany({});
    await database.collection(collectionName).insertMany([leadMine, leadOther, leadUnassigned]);

    const repView = await getTodayViewData(database, brand, {
      now: fixedNow,
      timezone: 'UTC',
      tenantId,
      scope: 'mine',
      userId: 'rep_1',
    });

    // Should include leadMine and leadUnassigned, but exclude leadOther
    expect(repView.counts.dueTodayFollowUps).toBe(2);
    const names = repView.dueTodayFollowUps.map((i) => i.entityName);
    expect(names).toContain('My Assigned Lead');
    expect(names).toContain('Unassigned Queue Item');
    expect(names).not.toContain('Other Rep Lead');
  });

  it('snoozes a follow-up via POST /api/leads/[id]/snooze and records an activity audit entry', async () => {
    const leadId = new ObjectId();
    await database.collection(collectionName).insertOne({
      _id: leadId,
      tenantId,
      entity_name: 'Snooze Target Ltd',
      nextActionDueAt: '2026-10-13T10:00:00.000Z',
      nextActionNote: 'Original note',
      updatedAt: new Date(),
    });

    const req = buildApiRequest(`http://localhost/api/leads/${leadId.toString()}/snooze?brand=${brand}`, {
      method: 'POST',
      body: JSON.stringify({ duration: '3d', note: 'Snoozed after voicemail' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await snoozePOST(req as any, { params: Promise.resolve({ id: leadId.toString() }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.nextActionDueAt).toBeTruthy();

    const updatedLead = await database.collection(collectionName).findOne({ _id: leadId });
    expect(new Date(updatedLead?.nextActionDueAt).getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(updatedLead?.nextActionNote).toBe('Snoozed after voicemail');

    // Audit log check
    const log = await database.collection(ACTIVITY_LOG_COLLECTION).findOne({
      leadId: leadId.toString(),
      type: 'note',
    });
    expect(log).toBeTruthy();
    expect(log?.bodyExcerpt).toContain('Follow-up snoozed (3d)');
  });

  it('marks a follow-up done via POST /api/leads/[id]/action-done', async () => {
    const leadId = new ObjectId();
    await database.collection(collectionName).insertOne({
      _id: leadId,
      tenantId,
      entity_name: 'Done Target Ltd',
      nextActionDueAt: '2026-10-13T10:00:00.000Z',
      nextActionNote: 'Needs completion',
      updatedAt: new Date(),
    });

    const req = buildApiRequest(`http://localhost/api/leads/${leadId.toString()}/action-done?brand=${brand}`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Follow-up call completed successfully' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await actionDonePOST(req as any, { params: Promise.resolve({ id: leadId.toString() }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.completed).toBe(true);

    const updatedLead = await database.collection(collectionName).findOne({ _id: leadId });
    expect(updatedLead?.nextActionDueAt).toBeNull();
    expect(updatedLead?.nextActionNote).toBeNull();

    // Audit log check
    const log = await database.collection(ACTIVITY_LOG_COLLECTION).findOne({
      leadId: leadId.toString(),
      bodyExcerpt: 'Follow-up call completed successfully',
    });
    expect(log).toBeTruthy();
  });

  it('serves valid TodayViewData via GET /api/today/[brand]', async () => {
    const req = buildApiRequest(`http://localhost/api/today/${brand}?scope=all`, {
      method: 'GET',
    });

    const res = await todayGET(req as any, { params: Promise.resolve({ brand }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('date');
    expect(body).toHaveProperty('counts');
    expect(body).toHaveProperty('cadenceTasks');
    expect(body).toHaveProperty('overdueFollowUps');
    expect(body).toHaveProperty('dueTodayFollowUps');
    expect(body).toHaveProperty('dealsNeedingAttention');
  });
});
