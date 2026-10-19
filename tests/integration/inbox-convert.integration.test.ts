import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { ACTIVITY_LOG_COLLECTION } from '../../app/lib/activity-log-store';

let mongod: MongoMemoryServer;
let convertPOST: typeof import('../../app/api/inbox/[brand]/convert/route').POST;

async function getTestDb() {
  const { getClientPromise } = await import('../../lib/mongodb');
  const client = await getClientPromise();
  return client.db();
}

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/inbox/[brand]/convert/route');
  convertPOST = mod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  const db = await getTestDb();
  await db.collection('leads').deleteMany({});
  await db.collection(ACTIVITY_LOG_COLLECTION).deleteMany({});
  await db.collection('outreach_logs').deleteMany({});
});

describe('POST /api/inbox/[brand]/convert', () => {
  it('converts an email thread into a new Lead and Deal and re-links activity log messages', async () => {
    const db = await getTestDb();

    const threadId = 'msg:inbound-thread-101';

    // Seed activity log entries for this thread with participants
    await db.collection(ACTIVITY_LOG_COLLECTION).insertMany([
      {
        threadId,
        brand: 'cogmap',
        tenantId: 'default',
        type: 'email-inbound',
        direction: 'inbound',
        fromAddress: '"Jane Smith" <jane@acme-sports.com>',
        toAddresses: ['cogmap@leads.haho.ai'],
        ccAddresses: ['"Bob CFO" <bob@acme-sports.com>'],
        subject: 'Partnership inquiry with CogMap',
        bodyExcerpt: 'Hi, we are interested in a 25k deal for Q4.\n\nBest,\nJane Smith\nVP Commercial\n+1 555-0199',
        source: 'inbound-webhook',
        createdAt: new Date(),
      },
    ]);

    const req = buildApiRequest('/api/inbox/cogmap/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        action: 'create_lead',
        lead: {
          entity_name: 'Acme Sports',
          url: 'https://acme-sports.com',
          country: 'US',
          kanbanColumn: 'DISCOVERED',
          contact: {
            name: 'Jane Smith',
            email: 'jane@acme-sports.com',
            title: 'VP Commercial',
            phone: '+1 555-0199',
            buyingRole: 'decision_maker',
          },
        },
        deal: {
          createDeal: true,
          value: 25000,
          currency: 'USD',
          label: 'Acme Sports - Q4 Partnership',
          probability: 60,
        },
      }),
    });

    const res = await convertPOST(req, { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.leadId).toBeDefined();
    expect(data.deal).toBeDefined();
    expect(data.deal.value).toBe(25000);
    expect(data.deal.currency).toBe('USD');

    // Verify lead was inserted in MongoDB
    const insertedLead = await db.collection('leads').findOne({ _id: new ObjectId(data.leadId) });
    expect(insertedLead).not.toBeNull();
    expect(insertedLead?.entity_name).toBe('Acme Sports');
    expect(insertedLead?.deals).toHaveLength(1);
    expect(insertedLead?.deals[0].value).toBe(25000);

    // Verify all thread participants (Jane and Bob) were harvested into lead.contacts
    expect(insertedLead?.contacts.length).toBeGreaterThanOrEqual(2);
    const emails = insertedLead?.contacts.map((c: any) => c.email);
    expect(emails).toContain('jane@acme-sports.com');
    expect(emails).toContain('bob@acme-sports.com');

    // Verify activityLog documents were re-linked to the new leadId
    const updatedMessages = await db.collection(ACTIVITY_LOG_COLLECTION).find({ threadId }).toArray();
    expect(updatedMessages[0].leadId).toBe(data.leadId);
  });

  it('adds a deal to an existing lead directly from the inbox thread', async () => {
    const db = await getTestDb();

    const insertResult = await db.collection('leads').insertOne({
      entity_name: 'FC Bayern',
      url: 'https://fcbayern.com',
      country: 'DE',
      contacts: [
        { name: 'Hans Mueller', email: 'hans@fcbayern.com', title: 'Director' },
      ],
      contactEmails: ['hans@fcbayern.com'],
      deals: [],
      tenantId: 'default',
      createdAt: new Date(),
    });
    const existingLeadId = insertResult.insertedId.toString();
    const threadId = 'thread-bayern-55';

    await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
      threadId,
      brand: 'cogmap',
      tenantId: 'default',
      type: 'email-inbound',
      fromAddress: 'hans@fcbayern.com',
      subject: 'Deal expansion',
      bodyExcerpt: 'Can we add 50k?',
      createdAt: new Date(),
    });

    const req = buildApiRequest('/api/inbox/cogmap/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        action: 'add_deal',
        existingLeadId,
        deal: {
          value: 50000,
          currency: 'EUR',
          label: 'FC Bayern - Expansion 2026',
        },
      }),
    });

    const res = await convertPOST(req, { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deal.value).toBe(50000);
    expect(data.deal.currency).toBe('EUR');

    const updatedLead = await db.collection('leads').findOne({ _id: insertResult.insertedId });
    expect(updatedLead?.deals).toHaveLength(1);
    expect(updatedLead?.deals[0].value).toBe(50000);
    expect(updatedLead?.deals[0].currency).toBe('EUR');
  });

  it('returns 409 when attempting to create a duplicate lead', async () => {
    const db = await getTestDb();

    // Seed existing lead
    const { buildFingerprint } = await import('../../lib/fingerprint');
    const fp = buildFingerprint('Existing Club', 'https://existing.com', 'US');
    await db.collection('leads').insertOne({
      entity_name: 'Existing Club',
      url: 'https://existing.com',
      country: 'US',
      fingerprint: fp,
      tenantId: 'default',
    });

    const req = buildApiRequest('/api/inbox/cogmap/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'msg:dup-1',
        action: 'create_lead',
        lead: {
          entity_name: 'Existing Club',
          url: 'https://existing.com',
          country: 'US',
          contact: {
            email: 'contact@existing.com',
          },
        },
      }),
    });

    const res = await convertPOST(req, { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.duplicate).toBe(true);
  });

  it('isolates multi-company participants and respects selectedContactEmails when converting', async () => {
    const db = await getTestDb();

    const threadId = 'msg:multi-org-thread-202';

    // Activity log entry containing participants from Romanian Handball Federation (frh.ro)
    // and Seyu team members (seyuselfies.com)
    await db.collection(ACTIVITY_LOG_COLLECTION).insertMany([
      {
        threadId,
        brand: 'cogmap',
        tenantId: 'default',
        type: 'email-inbound',
        direction: 'inbound',
        fromAddress: '"Kitty Erdei" <kitty.erdei@frh.ro>',
        toAddresses: ['"Tamas Sebestyen" <tamas.sebestyen@seyuselfies.com>'],
        ccAddresses: [
          '"Csaba Moldovan" <csaba.moldovan@seyuselfies.com>',
          '"Radu Popescu" <radu.popescu@frh.ro>',
        ],
        subject: 'FRH Collaboration Proposal',
        bodyExcerpt: 'Good morning, please see our proposal.\n\nKitty Erdei\nFRH Commercial Director',
        createdAt: new Date(),
      },
    ]);

    // Scenario A: Converting Kitty Erdei with explicit selectedContactEmails (only frh.ro contacts)
    const req = buildApiRequest('/api/inbox/cogmap/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        action: 'create_lead',
        selectedContactEmails: ['kitty.erdei@frh.ro', 'radu.popescu@frh.ro'],
        lead: {
          entity_name: 'FRH',
          url: 'https://frh.ro',
          country: 'RO',
          contact: {
            name: 'Kitty Erdei',
            email: 'kitty.erdei@frh.ro',
            title: 'Commercial Director',
          },
        },
      }),
    });

    const res = await convertPOST(req, { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);

    const leadDoc = await db.collection('leads').findOne({ _id: new ObjectId(data.leadId) });
    expect(leadDoc?.entity_name).toBe('FRH');
    expect(leadDoc?.country).toBe('RO');

    const savedEmails = leadDoc?.contacts.map((c: any) => c.email);
    expect(savedEmails).toContain('kitty.erdei@frh.ro');
    expect(savedEmails).toContain('radu.popescu@frh.ro');
    expect(savedEmails).not.toContain('tamas.sebestyen@seyuselfies.com');
    expect(savedEmails).not.toContain('csaba.moldovan@seyuselfies.com');
  });
});
