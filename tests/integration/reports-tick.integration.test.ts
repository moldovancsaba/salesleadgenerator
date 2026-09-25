import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let tickGET: typeof import('../../app/api/admin/reports-tick/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  tickGET = (await import('../../app/api/admin/reports-tick/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedDueReport(overrides: Record<string, unknown> = {}) {
  const database = await db();
  const doc = {
    id: `report_${Math.random().toString(36).slice(2)}`,
    brand: 'cogmap',
    tenantId: 'tick-test',
    name: 'Due Report',
    metric: 'lead_count',
    groupBy: [],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'table',
    schedule: {
      enabled: true,
      frequency: 'daily',
      hourUtc: 9,
      recipients: ['ops@example.com'],
      nextRunAt: new Date(Date.now() - 60_000).toISOString(), // already due
    },
    createdBy: 'test@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  await database.collection('report_definitions').insertOne(doc);
  return doc;
}

describe('GET /api/admin/reports-tick (issue 212)', () => {
  it('401s without a valid credential', async () => {
    const res = await tickGET(new NextRequest('http://localhost/api/admin/reports-tick'));
    expect(res.status).toBe(401);
  });

  it('processes a due, enabled definition and advances nextRunAt', async () => {
    const doc = await seedDueReport();
    const res = await tickGET(buildApiRequest('/api/admin/reports-tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBeGreaterThanOrEqual(1);

    const database = await db();
    const updated = await database.collection('report_definitions').findOne({ id: doc.id });
    expect(new Date(updated!.schedule.nextRunAt).getTime()).toBeGreaterThan(new Date(doc.schedule.nextRunAt).getTime());
    // No RESEND_API_KEY in this sandbox — the send itself fails, but the
    // tick must still run to completion and record a real, honest status
    // rather than crashing or silently marking it "ok".
    expect(updated!.lastRunStatus).toBe('error');
  });

  it('never processes a disabled or not-yet-due definition', async () => {
    const disabled = await seedDueReport({ id: 'report-disabled', schedule: { enabled: false, frequency: 'daily', hourUtc: 9, recipients: ['a@example.com'], nextRunAt: new Date(Date.now() - 60_000).toISOString() } });
    const future = await seedDueReport({ id: 'report-future', schedule: { enabled: true, frequency: 'daily', hourUtc: 9, recipients: ['a@example.com'], nextRunAt: new Date(Date.now() + 86_400_000).toISOString() } });

    await tickGET(buildApiRequest('/api/admin/reports-tick'));

    const database = await db();
    const disabledDoc = await database.collection('report_definitions').findOne({ id: disabled.id });
    const futureDoc = await database.collection('report_definitions').findOne({ id: future.id });
    expect(disabledDoc!.lastRunAt).toBeUndefined();
    expect(futureDoc!.lastRunAt).toBeUndefined();
  });

  it('tolerates a definition whose brand cannot be resolved, without aborting the batch', async () => {
    const unresolvable = await seedDueReport({ id: 'report-bad-brand', brand: 'not-a-real-brand' });
    const goodOne = await seedDueReport({ id: 'report-good' });

    const res = await tickGET(buildApiRequest('/api/admin/reports-tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failures.some((f: any) => f.reportId === unresolvable.id)).toBe(true);
    expect(body.processed).toBeGreaterThanOrEqual(2);

    const database = await db();
    const goodDoc = await database.collection('report_definitions').findOne({ id: goodOne.id });
    expect(goodDoc!.lastRunAt).toBeTruthy();
  });
});
