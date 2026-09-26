import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Delivery is mocked at the module boundary so both sides of issue #224's
// guard can be exercised: sending not configured (run held) vs configured
// but the send failing (run still advances, recorded as an error).
const deliveryConfiguredMock = vi.fn(() => false);
const sendReportEmailMock = vi.fn();
vi.mock('../../lib/report-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/report-delivery')>();
  return {
    ...actual,
    isReportDeliveryConfigured: () => deliveryConfiguredMock(),
    sendReportEmail: (...args: any[]) => sendReportEmailMock(...args),
  };
});

beforeEach(() => {
  deliveryConfiguredMock.mockReturnValue(false);
  sendReportEmailMock.mockReset();
  sendReportEmailMock.mockResolvedValue({ sent: false, reason: 'Resend rejected the send' });
});

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

  it('with delivery configured but the send failing, still advances nextRunAt and records an error', async () => {
    deliveryConfiguredMock.mockReturnValue(true);
    const doc = await seedDueReport();
    const res = await tickGET(buildApiRequest('/api/admin/reports-tick'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(sendReportEmailMock).toHaveBeenCalled();

    const database = await db();
    const updated = await database.collection('report_definitions').findOne({ id: doc.id });
    expect(new Date(updated!.schedule.nextRunAt).getTime()).toBeGreaterThan(new Date(doc.schedule.nextRunAt).getTime());
    // A configured-but-failing send must still let the tick finish and
    // record an honest status rather than crashing or claiming "ok".
    expect(updated!.lastRunStatus).toBe('error');
  });

  it('with delivery configured and the send succeeding, advances nextRunAt with status ok', async () => {
    deliveryConfiguredMock.mockReturnValue(true);
    sendReportEmailMock.mockResolvedValue({ sent: true });
    const doc = await seedDueReport();
    await tickGET(buildApiRequest('/api/admin/reports-tick'));

    const database = await db();
    const updated = await database.collection('report_definitions').findOne({ id: doc.id });
    expect(updated!.lastRunStatus).toBe('ok');
    expect(new Date(updated!.schedule.nextRunAt).getTime()).toBeGreaterThan(new Date(doc.schedule.nextRunAt).getTime());
  });

  // Issue #224: without RESEND_API_KEY the run must be held, not skipped.
  it('with delivery not configured, holds the run: no send attempt, nextRunAt and status unchanged', async () => {
    const doc = await seedDueReport();
    const res = await tickGET(buildApiRequest('/api/admin/reports-tick'));
    const body = await res.json();
    expect(sendReportEmailMock).not.toHaveBeenCalled();
    expect(body.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ reportId: doc.id, reason: expect.stringContaining('not configured') })])
    );

    const database = await db();
    const updated = await database.collection('report_definitions').findOne({ id: doc.id });
    expect(updated!.schedule.nextRunAt).toBe(doc.schedule.nextRunAt);
    expect(updated!.lastRunStatus).toBeUndefined();
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
    deliveryConfiguredMock.mockReturnValue(true);
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
