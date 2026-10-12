import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { NextRequest } from 'next/server';

let mongod: MongoMemoryServer;
let pipelinesGET: typeof import('../../app/api/pipelines/route').GET;
let pipelinesPOST: typeof import('../../app/api/pipelines/route').POST;
let pipelineIdGET: typeof import('../../app/api/pipelines/[id]/route').GET;
let pipelineIdPATCH: typeof import('../../app/api/pipelines/[id]/route').PATCH;
let pipelineIdDELETE: typeof import('../../app/api/pipelines/[id]/route').DELETE;

beforeAll(async () => {
  mongod = await startTestMongo();
  const pipelinesMod = await import('../../app/api/pipelines/route');
  pipelinesGET = pipelinesMod.GET;
  pipelinesPOST = pipelinesMod.POST;
  const pipelineIdMod = await import('../../app/api/pipelines/[id]/route');
  pipelineIdGET = pipelineIdMod.GET;
  pipelineIdPATCH = pipelineIdMod.PATCH;
  pipelineIdDELETE = pipelineIdMod.DELETE;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

describe('Pipelines API (issue 235 - Vega CRM Phase 1)', () => {
  it('returns canonical default pipeline when none are stored', async () => {
    const res = await pipelinesGET(req('http://localhost/api/pipelines?brand=cogmap'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipelines).toHaveLength(1);
    expect(body.pipelines[0].isDefault).toBe(true);
    expect(body.pipelines[0].name).toBe('Default Pipeline');
    expect(body.pipelines[0].stages).toHaveLength(6);
  });

  it('creates a custom brand pipeline via POST', async () => {
    const res = await pipelinesPOST(
      req('http://localhost/api/pipelines?brand=cogmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'pipe_tech_licensing',
          name: 'Tech Licensing',
          stages: [
            { key: 'PROSPECT', label: 'Prospect', color: 'blue', order: 0 },
            { key: 'TECH_EVAL', label: 'Tech Evaluation', color: 'indigo', order: 1, probability: 40 },
            { key: 'COMMERCIAL', label: 'Commercial Terms', color: 'orange', order: 2, probability: 70 },
            { key: 'CLOSED_WON', label: 'Closed Won', color: 'teal', order: 3, isWon: true, probability: 100 },
          ],
        }),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.pipeline.id).toBe('pipe_tech_licensing');
    expect(body.pipeline.name).toBe('Tech Licensing');
    expect(body.pipeline.stages).toHaveLength(4);
  });

  it('lists both pipelines after creation', async () => {
    const res = await pipelinesGET(req('http://localhost/api/pipelines?brand=cogmap'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipelines).toHaveLength(1); // One custom in DB, so DB docs returned
    const custom = body.pipelines.find((p: any) => p.id === 'pipe_tech_licensing');
    expect(custom).toBeDefined();
    expect(custom.name).toBe('Tech Licensing');
  });

  it('fetches a single pipeline by ID', async () => {
    const res = await pipelineIdGET(
      req('http://localhost/api/pipelines/pipe_tech_licensing?brand=cogmap'),
      { params: Promise.resolve({ id: 'pipe_tech_licensing' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline.id).toBe('pipe_tech_licensing');
    expect(body.pipeline.name).toBe('Tech Licensing');
  });

  it('updates a pipeline via PATCH', async () => {
    const res = await pipelineIdPATCH(
      req('http://localhost/api/pipelines/pipe_tech_licensing?brand=cogmap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Tech & Data Licensing',
        }),
      }),
      { params: Promise.resolve({ id: 'pipe_tech_licensing' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline.name).toBe('Tech & Data Licensing');
  });

  it('refuses to delete a pipeline when active deals exist', async () => {
    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();

    // Insert a lead in cogmap's collection with a deal assigned to this pipeline
    await db.collection('leads').insertOne({
      entity_name: 'Tech Corp',
      tenantId: 'default',
      deals: [{ id: 'd1', value: 50000, pipelineId: 'pipe_tech_licensing' }],
    });

    const res = await pipelineIdDELETE(
      req('http://localhost/api/pipelines/pipe_tech_licensing?brand=cogmap', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'pipe_tech_licensing' }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('active deal');

    // Remove the lead deal
    await db.collection('leads').deleteMany({ entity_name: 'Tech Corp' });
  });

  it('deletes an unpopulated custom pipeline via DELETE', async () => {
    const res = await pipelineIdDELETE(
      req('http://localhost/api/pipelines/pipe_tech_licensing?brand=cogmap', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'pipe_tech_licensing' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe('pipe_tech_licensing');

    // Verify it is gone
    const getRes = await pipelineIdGET(
      req('http://localhost/api/pipelines/pipe_tech_licensing?brand=cogmap'),
      { params: Promise.resolve({ id: 'pipe_tech_licensing' }) }
    );
    expect(getRes.status).toBe(404);
  });
});
