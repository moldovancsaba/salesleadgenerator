import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest, TEST_API_KEY } from './helpers/api-request';
import { contactKey } from '../../lib/contacts';

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let activityGET: typeof import('../../app/api/leads/[id]/activity/route').GET;
let activityPOST: typeof import('../../app/api/leads/[id]/activity/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  leadsGET = leadsMod.GET;
  const activityMod = await import('../../app/api/leads/[id]/activity/route');
  activityGET = activityMod.GET;
  activityPOST = activityMod.POST;
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

async function getLead(leadId: string): Promise<any> {
  const res = await leadsGET(req('/api/leads?brand=cogmap'));
  const body = await res.json();
  return body.leads.find((l: any) => l._id === leadId);
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

// Issue #200 — manual call logging.
describe('POST /api/leads/[id]/activity', () => {
  it('creates an activityLog document with type: call and advances the lead\'s updatedAt', async () => {
    const leadId = await createLead('Call Log FC');
    const before = await getLead(leadId);
    const key = contactKey(before.contacts[0]);

    const res = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'connected', durationMinutes: 12, notes: 'Discussed renewal.' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe('call');
    expect(body.disposition).toBe('connected');
    expect(body.leadId).toBe(leadId);

    const after = await getLead(leadId);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  });

  it('rejects an unknown disposition (400) and writes no document', async () => {
    const leadId = await createLead('Bad Disposition FC');
    const lead = await getLead(leadId);
    const key = contactKey(lead.contacts[0]);

    const res = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'answered' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(400);

    const getRes = await activityGET(req(`/api/leads/${leadId}/activity?brand=cogmap`), { params: Promise.resolve({ id: leadId }) });
    const getBody = await getRes.json();
    expect(getBody.activity).toEqual([]);
  });

  it('rejects a non-positive duration (400)', async () => {
    const leadId = await createLead('Bad Duration FC');
    const lead = await getLead(leadId);
    const key = contactKey(lead.contacts[0]);

    const zero = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'connected', durationMinutes: 0 }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(zero.status).toBe(400);

    const negative = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'connected', durationMinutes: -5 }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(negative.status).toBe(400);
  });

  it('rejects a contactKey not present on the lead\'s current contacts[] (400)', async () => {
    const leadId = await createLead('Unknown Contact FC');
    const res = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: 'nobody real|+1 555 9999', disposition: 'connected' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/[Cc]ontact/);
  });

  it('rejects a request with no valid auth (401), writes no document', async () => {
    const leadId = await createLead('Unauthed Call Log FC');
    const lead = await getLead(leadId);
    const key = contactKey(lead.contacts[0]);
    const NextRequest = (await import('next/server')).NextRequest;

    const res = await activityPOST(
      new NextRequest(`http://localhost/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'connected' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(401);

    const getRes = await activityGET(req(`/api/leads/${leadId}/activity?brand=cogmap`), { params: Promise.resolve({ id: leadId }) });
    const getBody = await getRes.json();
    expect(getBody.activity).toEqual([]);
  });

  it('the logged call appears in GET\'s merged timeline in the correct sort position', async () => {
    const leadId = await createLead('Merged Timeline FC');
    const lead = await getLead(leadId);
    const key = contactKey(lead.contacts[0]);
    await insertOutreachLog(leadId, 'Older email', new Date('2026-07-01T00:00:00.000Z'));

    const postRes = await activityPOST(
      req(`/api/leads/${leadId}/activity?brand=cogmap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactKey: key, disposition: 'voicemail' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(postRes.status).toBe(201);

    const getRes = await activityGET(req(`/api/leads/${leadId}/activity?brand=cogmap`), { params: Promise.resolve({ id: leadId }) });
    const getBody = await getRes.json();
    // The call was just logged (now) — newer than the 2026-07-01 email —
    // so it sorts first in the newest-first merged timeline.
    expect(getBody.activity[0].type).toBe('call');
    expect(getBody.activity[0].callDisposition).toBe('voicemail');
    expect(getBody.activity[1].subject).toBe('Older email');
  });
});
