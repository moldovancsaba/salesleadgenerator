import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

let mongod: MongoMemoryServer;
let listGET: typeof import('../../app/api/reports/route').GET;
let listPOST: typeof import('../../app/api/reports/route').POST;
let itemGET: typeof import('../../app/api/reports/[id]/route').GET;
let itemPATCH: typeof import('../../app/api/reports/[id]/route').PATCH;
let itemDELETE: typeof import('../../app/api/reports/[id]/route').DELETE;
let runPOST: typeof import('../../app/api/reports/[id]/run/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/reports/route');
  listGET = listMod.GET;
  listPOST = listMod.POST;
  const itemMod = await import('../../app/api/reports/[id]/route');
  itemGET = itemMod.GET;
  itemPATCH = itemMod.PATCH;
  itemDELETE = itemMod.DELETE;
  runPOST = (await import('../../app/api/reports/[id]/run/route')).POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

function jsonBody(body: unknown) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const VALID_DEFINITION = {
  name: 'Leads by industry',
  chartType: 'table',
  metric: 'lead_count',
  groupBy: ['industry'],
  filters: [],
  dateRange: { mode: 'all' },
};

describe('Reports CRUD (issue 212)', () => {
  it('POST creates a report definition, GET lists it', async () => {
    const res = await listPOST(
      buildApiRequest('/api/reports?brand=cogmap&tenantId=crud-test', jsonBody(VALID_DEFINITION))
    );
    expect(res.status).toBe(201);
    const created = (await res.json()).report;
    expect(created.name).toBe('Leads by industry');
    expect(created.id).toBeTruthy();

    const listRes = await listGET(buildApiRequest('/api/reports?brand=cogmap&tenantId=crud-test'));
    const list = await listRes.json();
    expect(list.reports.some((r: any) => r.id === created.id)).toBe(true);
  });

  it('POST rejects an invalid definition (bad metric) with 400', async () => {
    const res = await listPOST(buildApiRequest('/api/reports?brand=cogmap&tenantId=crud-test', jsonBody({ ...VALID_DEFINITION, metric: 'not_real' })));
    expect(res.status).toBe(400);
  });

  it('GET/PATCH/DELETE a single report by id', async () => {
    const created = (await (await listPOST(buildApiRequest('/api/reports?brand=cogmap&tenantId=crud-test', jsonBody(VALID_DEFINITION)))).json()).report;

    const getRes = await itemGET(buildApiRequest(`/api/reports/${created.id}?brand=cogmap&tenantId=crud-test`), { params: Promise.resolve({ id: created.id }) });
    expect(getRes.status).toBe(200);

    const patchRes = await itemPATCH(
      buildApiRequest(`/api/reports/${created.id}?brand=cogmap&tenantId=crud-test`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }) }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).report.name).toBe('Renamed');

    const deleteRes = await itemDELETE(buildApiRequest(`/api/reports/${created.id}?brand=cogmap&tenantId=crud-test`, { method: 'DELETE' }), { params: Promise.resolve({ id: created.id }) });
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await itemGET(buildApiRequest(`/api/reports/${created.id}?brand=cogmap&tenantId=crud-test`), { params: Promise.resolve({ id: created.id }) });
    expect(getAfterDelete.status).toBe(404);
  });

  it('401s without a valid credential', async () => {
    const res = await listGET(new NextRequest('http://localhost/api/reports?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('enforces tenant isolation — a report in tenant A never resolves for tenant B', async () => {
    const created = (await (await listPOST(buildApiRequest('/api/reports?brand=cogmap&tenantId=tenant-a', jsonBody(VALID_DEFINITION)))).json()).report;

    const listB = await listGET(buildApiRequest('/api/reports?brand=cogmap&tenantId=tenant-b'));
    expect((await listB.json()).reports.find((r: any) => r.id === created.id)).toBeUndefined();

    const getB = await itemGET(buildApiRequest(`/api/reports/${created.id}?brand=cogmap&tenantId=tenant-b`), { params: Promise.resolve({ id: created.id }) });
    expect(getB.status).toBe(404);
  });

  it('POST .../run executes the pipeline against real seeded leads and returns shaped rows', async () => {
    const database = await db();
    await database.collection('leads').insertMany([
      { entity_name: 'Sports Co', industry: 'Sports', tenantId: 'run-test', kanbanColumn: 'QUALIFIED', createdAt: new Date().toISOString(), contacts: [] },
      { entity_name: 'Media Co', industry: 'Media', tenantId: 'run-test', kanbanColumn: 'QUALIFIED', createdAt: new Date().toISOString(), contacts: [] },
      { entity_name: 'Sports Co 2', industry: 'Sports', tenantId: 'run-test', kanbanColumn: 'QUALIFIED', createdAt: new Date().toISOString(), contacts: [] },
    ]);

    const created = (await (await listPOST(buildApiRequest('/api/reports?brand=cogmap&tenantId=run-test', jsonBody(VALID_DEFINITION)))).json()).report;
    const runRes = await runPOST(buildApiRequest(`/api/reports/${created.id}/run?brand=cogmap&tenantId=run-test`, { method: 'POST' }), { params: Promise.resolve({ id: created.id }) });
    expect(runRes.status).toBe(200);
    const body = await runRes.json();
    const sportsRow = body.rows.find((r: any) => r.groupKey.industry === 'Sports');
    expect(sportsRow.value).toBe(2);
    const mediaRow = body.rows.find((r: any) => r.groupKey.industry === 'Media');
    expect(mediaRow.value).toBe(1);
  });

  it('POST .../run never returns a lead from a different brand collection', async () => {
    const database = await db();
    await database.collection('seyu_leads').insertOne({ entity_name: 'Seyu Only Co', industry: 'Sports', tenantId: 'cross-brand-test', kanbanColumn: 'QUALIFIED', createdAt: new Date().toISOString(), contacts: [] });

    const created = (await (await listPOST(buildApiRequest('/api/reports?brand=cogmap&tenantId=cross-brand-test', jsonBody(VALID_DEFINITION)))).json()).report;
    const runRes = await runPOST(buildApiRequest(`/api/reports/${created.id}/run?brand=cogmap&tenantId=cross-brand-test`, { method: 'POST' }), { params: Promise.resolve({ id: created.id }) });
    const body = await runRes.json();
    expect(body.rows.find((r: any) => r.groupKey.industry === 'Sports')).toBeUndefined();
  });
});
