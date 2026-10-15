import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { isMessageHistorical } from '../../lib/lead-timeline-filter';

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
      contacts: [{ name: 'Alex Rivera', email: `alex@${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`, isDecisionMaker: true }],
    }),
  }));
  expect(res.status).toBe(201);
  const listRes = await leadsGET(req('/api/leads?brand=cogmap'));
  const listBody = await listRes.json();
  return listBody.leads.find((l: any) => l.entity_name === entityName)._id as string;
}

async function insertActivityEntry(
  leadId: string,
  subject: string,
  createdAt: Date,
  isHistorical?: boolean
) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  await client.db().collection('activityLog').insertOne({
    leadId,
    tenantId: 'default',
    brand: 'cogmap',
    type: 'email-inbound',
    direction: 'inbound',
    fromAddress: 'alex@example.com',
    subject,
    bodyExcerpt: `Excerpt for ${subject}`,
    source: 'gmail-sync',
    createdAt,
    ...(isHistorical ? { isHistorical: true } : {}),
  });
  await client.close();
}

describe('Lead activity historical message filtering (Issue 244)', () => {
  it('filters historical pre-lead correspondence by default and exposes historicalCount', async () => {
    const leadId = await createLead('Historical Test Corp');

    // Recent activity (after lead creation)
    await insertActivityEntry(leadId, 'Active recent discussion', new Date(), false);

    // Historical activity (predating lead creation)
    const ancientDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    await insertActivityEntry(leadId, 'Old pre-lead correspondence 1', ancientDate, true);
    await insertActivityEntry(leadId, 'Old pre-lead correspondence 2', new Date(ancientDate.getTime() + 1000), true);

    // 1. Default request (includeHistorical omitted / false)
    const defaultRes = await activityGET(
      req(`/api/leads/${leadId}/activity?brand=cogmap`),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(defaultRes.status).toBe(200);
    const defaultBody = await defaultRes.json();
    expect(defaultBody.historicalCount).toBe(2);
    expect(defaultBody.activity.length).toBe(1);
    expect(defaultBody.activity[0].subject).toBe('Active recent discussion');
    expect(defaultBody.activity[0].isHistorical).toBeUndefined();

    // 2. Explicit request with includeHistorical=true
    const expandedRes = await activityGET(
      req(`/api/leads/${leadId}/activity?brand=cogmap&includeHistorical=true`),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(expandedRes.status).toBe(200);
    const expandedBody = await expandedRes.json();
    expect(expandedBody.historicalCount).toBe(2);
    expect(expandedBody.activity.length).toBe(3);
    const subjects = expandedBody.activity.map((a: any) => a.subject);
    expect(subjects).toContain('Active recent discussion');
    expect(subjects).toContain('Old pre-lead correspondence 1');
    expect(subjects).toContain('Old pre-lead correspondence 2');

    const historicalEntries = expandedBody.activity.filter((a: any) => a.isHistorical === true);
    expect(historicalEntries.length).toBe(2);
  });

  it('preserves cadence when matched inbound email is identified as historical', async () => {
    const leadId = await createLead('Cadence Preservation Lead');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();

    // Set an active cadence on the lead with creation date 10 days ago
    const leadCreated = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await client.db().collection('leads').updateOne(
      { _id: new ObjectId(leadId) },
      {
        $set: {
          createdAt: leadCreated,
          activeCadence: {
            cadenceId: 'cad_123',
            name: 'Outbound Sequence',
            stepIndex: 1,
            stepChannel: 'email',
            status: 'active',
          },
        },
      }
    );

    // Simulate an email arriving that is 20 days old (10 days prior to lead creation)
    const oldEmailDate = new Date(leadCreated.getTime() - 10 * 24 * 60 * 60 * 1000);
    const historical = isMessageHistorical(oldEmailDate, leadCreated);
    expect(historical).toBe(true);

    // Verify lead's activeCadence remains untouched
    const leadDoc = await client.db().collection('leads').findOne({ _id: new ObjectId(leadId) });
    expect(leadDoc?.activeCadence).not.toBeNull();
    expect(leadDoc?.activeCadence?.status).toBe('active');

    await client.close();
  });
});
