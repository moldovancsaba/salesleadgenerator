import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest, TEST_API_KEY } from './helpers/api-request';

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let activityGET: typeof import('../../app/api/leads/[id]/activity/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  leadsGET = leadsMod.GET;
  const activityMod = await import('../../app/api/leads/[id]/activity/route');
  activityGET = activityMod.GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: Parameters<typeof buildApiRequest>[1]) {
  return buildApiRequest(url, init);
}

async function createLead(entityName: string): Promise<string> {
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts: [{ name: 'Jordan Smith', email: `jordan@${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`, phone: '+1 555 0100', isDecisionMaker: true }],
    }),
  }));
  expect(res.status).toBe(201);
  const listRes = await leadsGET(req('/api/leads?brand=cogmap'));
  const listBody = await listRes.json();
  return listBody.leads.find((l: any) => l.entity_name === entityName)._id as string;
}

async function insertOutreachLog(leadId: string, subject: string, createdAt: Date) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  await client.db().collection('outreach_logs').insertOne({
    tenantId: 'default', leadId, brand: 'cogmap', channel: 'email',
    subject, body: `Body for ${subject}`, routingAllowed: true, routingReason: null, createdAt,
  });
  await client.close();
}

async function insertActivityLogEntry(leadId: string, subject: string, createdAt: Date) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  await client.db().collection('activityLog').insertOne({
    leadId, tenantId: 'default', brand: 'cogmap', type: 'email-inbound', direction: 'inbound',
    fromAddress: 'lead-contact@example.com', subject, bodyExcerpt: `Reply: ${subject}`,
    source: 'inbound-webhook', createdAt,
  });
  await client.close();
}

describe('GET /api/leads/[id]/activity', () => {
  it('merges activityLog and outreach_logs for one lead, newest first', async () => {
    const leadId = await createLead('Activity Test FC');
    await insertOutreachLog(leadId, 'Intro email', new Date('2026-07-01T00:00:00.000Z'));
    await insertActivityLogEntry(leadId, 'Thanks, interested', new Date('2026-07-05T00:00:00.000Z'));
    await insertOutreachLog(leadId, 'Follow-up', new Date('2026-07-10T00:00:00.000Z'));

    const res = await activityGET(
      req(`/api/leads/${leadId}/activity?brand=cogmap`),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity.map((e: any) => e.subject)).toEqual(['Follow-up', 'Thanks, interested', 'Intro email']);
    expect(body.activity[1].type).toBe('email-inbound');
    expect(body.activity[1].direction).toBe('inbound');
    expect(body.activity[0].type).toBe('email-outbound');
    expect(body.activity[0].source).toBe('outreach-log');
  });

  it('does not leak activity from a different lead', async () => {
    const leadA = await createLead('Activity Lead A');
    const leadB = await createLead('Activity Lead B');
    await insertOutreachLog(leadA, 'Only for A', new Date());

    const res = await activityGET(
      req(`/api/leads/${leadB}/activity?brand=cogmap`),
      { params: Promise.resolve({ id: leadB }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual([]);
  });

  it('returns an empty array for a lead with no activity, not an error', async () => {
    const leadId = await createLead('No Activity FC');
    const res = await activityGET(
      req(`/api/leads/${leadId}/activity?brand=cogmap`),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual([]);
  });

  it('rejects a request with no valid auth', async () => {
    const leadId = await createLead('Unauthed FC');
    const NextRequest = (await import('next/server')).NextRequest;
    const res = await activityGET(
      new NextRequest(`http://localhost/api/leads/${leadId}/activity?brand=cogmap`),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(401);
  });

  it('accepts x-api-key auth (the same machine-to-machine path every other lead route uses)', async () => {
    const leadId = await createLead('Api Key Auth FC');
    const NextRequest = (await import('next/server')).NextRequest;
    const res = await activityGET(
      new NextRequest(`http://localhost/api/leads/${leadId}/activity?brand=cogmap`, {
        headers: { 'x-api-key': TEST_API_KEY },
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(200);
  });
});
