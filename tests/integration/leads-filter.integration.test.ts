import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// GET /api/leads and GET /api/leads/columns's new region/industry filter
// params (issue #71). Seeds directly via the driver (matching
// leads-patch-actions.integration.test.ts's pattern) rather than through
// POST /api/leads, whose own quality-gate check is unrelated to what's
// being tested here.

let mongod: MongoMemoryServer;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let columnsGET: typeof import('../../app/api/leads/columns/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  leadsGET = (await import('../../app/api/leads/route')).GET;
  columnsGET = (await import('../../app/api/leads/columns/route')).GET;
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
    region: 'US',
    industry: 'Academy',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    createdAt: new Date(),
    ...overrides,
  });
  return result.insertedId.toString();
}

function req(url: string) {
  return buildApiRequest(url);
}

describe('GET /api/leads — region/industry filters (issue #71)', () => {
  it('filters by region exactly', async () => {
    await seedLead('US Academy Co', { region: 'US' });
    await seedLead('CEE Academy Co', { region: 'CEE' });

    const res = await leadsGET(req('/api/leads?brand=cogmap&region=CEE'));
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).toEqual(['CEE Academy Co']);
  });

  it('filters by industry case-insensitively', async () => {
    await seedLead('Federation Co', { industry: 'Federation', region: 'MENA' });

    const res = await leadsGET(req('/api/leads?brand=cogmap&industry=federation'));
    const body = await res.json();
    expect(body.leads.some((l: any) => l.entity_name === 'Federation Co')).toBe(true);
  });

  it('treats a regex special character in industry as a literal, not a pattern', async () => {
    await seedLead('Regex Test Co', { industry: 'Sports (Youth)', region: 'US' });

    const res = await leadsGET(req(`/api/leads?brand=cogmap&industry=${encodeURIComponent('Sports (Youth)')}`));
    const body = await res.json();
    expect(body.leads.some((l: any) => l.entity_name === 'Regex Test Co')).toBe(true);
  });

  it('combines region and industry filters', async () => {
    await seedLead('Match Both Co', { region: 'MENA', industry: 'Club Combo' });
    await seedLead('Wrong Region Co', { region: 'US', industry: 'Club Combo' });

    const res = await leadsGET(req('/api/leads?brand=cogmap&region=MENA&industry=Club%20Combo'));
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).toEqual(['Match Both Co']);
  });
});

describe('GET /api/leads/columns — region/industry filters (issue #71)', () => {
  it('filters a single column by region', async () => {
    await seedLead('Column US Co', { kanbanColumn: 'QUALIFIED', region: 'US' });
    await seedLead('Column CEE Co', { kanbanColumn: 'QUALIFIED', region: 'CEE' });

    const res = await columnsGET(req('/api/leads/columns?brand=cogmap&column=QUALIFIED&region=US'));
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).toContain('Column US Co');
    expect(body.leads.map((l: any) => l.entity_name)).not.toContain('Column CEE Co');
  });

  it('filters a single column by industry', async () => {
    await seedLead('Column Industry Match Co', { kanbanColumn: 'ENGAGED', industry: 'Distinctive Industry' });

    const res = await columnsGET(req('/api/leads/columns?brand=cogmap&column=ENGAGED&industry=distinctive'));
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).toContain('Column Industry Match Co');
  });
});
