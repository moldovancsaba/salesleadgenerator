import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Gmail/Google Contacts sync (issue #216), built on the third-party
// integration hub (issue #217). These env vars are read at module level by
// app/lib/integration-store.ts and lib/integration-crypto.ts, so they must
// be set before those modules are first imported below.
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://salesleadgenerator.example.com/api/integrations/oauth/callback';

let mongod: MongoMemoryServer;
let gmailSyncGET: typeof import('../../app/api/integrations/gmail/sync/route').GET;
let contactsSearchGET: typeof import('../../app/api/integrations/google-contacts/search/route').GET;
let importGooglePOST: typeof import('../../app/api/leads/[id]/contacts/import-google/route').POST;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let activityGET: typeof import('../../app/api/leads/[id]/activity/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  gmailSyncGET = (await import('../../app/api/integrations/gmail/sync/route')).GET;
  contactsSearchGET = (await import('../../app/api/integrations/google-contacts/search/route')).GET;
  importGooglePOST = (await import('../../app/api/leads/[id]/contacts/import-google/route')).POST;
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  activityGET = (await import('../../app/api/leads/[id]/activity/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function createGmailConnection(brand: string) {
  const { encryptCredentials } = await import('../../lib/integration-crypto');
  const database = await db();
  const now = new Date().toISOString();
  await database.collection('integration_connections').insertOne({
    id: `intconn_test_${brand}_gmail`,
    brand, tenantId: 'default', provider: 'gmail', authMethod: 'oauth2',
    encryptedCredentials: encryptCredentials({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    connectedBy: 'admin-1', connectedAt: now, status: 'active', updatedAt: now, revokedAt: null,
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

async function createGoogleContactsConnection(brand: string) {
  const { encryptCredentials } = await import('../../lib/integration-crypto');
  const database = await db();
  const now = new Date().toISOString();
  await database.collection('integration_connections').insertOne({
    id: `intconn_test_${brand}_contacts`,
    brand, tenantId: 'default', provider: 'google_contacts', authMethod: 'oauth2',
    encryptedCredentials: encryptCredentials({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    connectedBy: 'admin-1', connectedAt: now, status: 'active', updatedAt: now, revokedAt: null,
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

let leadCounter = 0;
async function createLeadWithContactEmail(email: string): Promise<string> {
  const slug = `gmail-sync-test-${leadCounter++}`;
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: `Gmail Sync Test Org ${slug}`,
      url: `https://${slug}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts: [{ name: 'Known Lead Contact', email, isDecisionMaker: true }],
    }),
  }));
  const body = await res.json();
  if (!body.lead) throw new Error(`createLeadWithContactEmail failed: ${res.status} ${JSON.stringify(body)}`);
  return body.lead._id;
}

const fetchCalls: string[] = [];

function mockGmailAndPeople(options: {
  gmailAddress?: string;
  messages?: Array<{ id: string; from: string; to: string[]; cc?: string[]; subject: string; dateIso: string; messageIdHeader?: string; body?: string }>;
  contactsSearchResults?: any[];
  contactsGet?: any;
} = {}) {
  fetchCalls.length = 0;
  const gmailAddress = options.gmailAddress ?? 'rep@example.com';
  const messages = options.messages ?? [];

  global.fetch = vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    fetchCalls.push(url);

    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/profile')) {
      return new Response(JSON.stringify({ emailAddress: gmailAddress }), { status: 200 });
    }
    if (url.includes('/messages?')) {
      return new Response(JSON.stringify({ messages: messages.map((m) => ({ id: m.id })) }), { status: 200 });
    }
    const metaMatch = url.match(/\/messages\/([^?]+)\?.*format=metadata/);
    if (metaMatch) {
      const msg = messages.find((m) => m.id === metaMatch[1]);
      if (!msg) return new Response(JSON.stringify({}), { status: 404 });
      const headers = [
        { name: 'From', value: msg.from },
        { name: 'To', value: msg.to.join(', ') },
        { name: 'Cc', value: (msg.cc || []).join(', ') },
        { name: 'Subject', value: msg.subject },
        { name: 'Date', value: msg.dateIso },
        { name: 'Message-ID', value: msg.messageIdHeader ?? `<${msg.id}@mail.gmail.com>` },
      ];
      return new Response(JSON.stringify({ id: msg.id, payload: { headers } }), { status: 200 });
    }
    const fullMatch = url.match(/\/messages\/([^?]+)\?.*format=full/);
    if (fullMatch) {
      const msg = messages.find((m) => m.id === fullMatch[1]);
      if (!msg) return new Response(JSON.stringify({}), { status: 404 });
      const bodyText = msg.body ?? 'Test message body';
      return new Response(JSON.stringify({
        id: msg.id,
        payload: { mimeType: 'text/plain', body: { data: Buffer.from(bodyText, 'utf8').toString('base64') } },
      }), { status: 200 });
    }
    if (url.startsWith('https://people.googleapis.com/v1/people:searchContacts')) {
      return new Response(JSON.stringify({ results: (options.contactsSearchResults || []).map((p) => ({ person: p })) }), { status: 200 });
    }
    if (url.startsWith('https://people.googleapis.com/v1/')) {
      return new Response(JSON.stringify(options.contactsGet || {}), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as any;
}

describe('Gmail sync poll (issue 216)', () => {
  it('ingests a message from a known contact into activityLog, matched to the right lead', async () => {
    const leadId = await createLeadWithContactEmail('known-contact@example.com');
    await createGmailConnection('cogmap');
    mockGmailAndPeople({
      messages: [{
        id: 'msg-1', from: 'known-contact@example.com', to: ['rep@example.com'], subject: 'Hello',
        dateIso: new Date().toUTCString(), body: 'Real reply body',
      }],
    });

    const res = await gmailSyncGET(req('/api/integrations/gmail/sync'));
    const summary = await res.json();
    expect(summary.ingested).toBe(1);

    const activityRes = await activityGET(req(`/api/leads/${leadId}/activity?brand=cogmap`), { params: Promise.resolve({ id: leadId }) });
    const activityBody = await activityRes.json();
    const gmailEntry = activityBody.activity.find((e: any) => e.source === 'gmail-sync');
    expect(gmailEntry).toBeTruthy();
    expect(gmailEntry.direction).toBe('inbound');
    expect(gmailEntry.subject).toBe('Hello');
  });

  it('never fetches the body of a message with no known participant', async () => {
    await createLeadWithContactEmail('known-contact-2@example.com');
    await createGmailConnection('cogmap');
    mockGmailAndPeople({
      messages: [{
        id: 'msg-unrelated', from: 'stranger@nowhere.example.com', to: ['rep@example.com'], subject: 'Spam',
        dateIso: new Date().toUTCString(),
      }],
    });

    const res = await gmailSyncGET(req('/api/integrations/gmail/sync'));
    const summary = await res.json();
    expect(summary.ingested).toBe(0);
    expect(fetchCalls.some((u) => u.includes('msg-unrelated') && u.includes('format=full'))).toBe(false);
  });

  it('re-running the poll for the same window never produces a duplicate entry', async () => {
    const leadId = await createLeadWithContactEmail('repeat-contact@example.com');
    await createGmailConnection('cogmap');
    mockGmailAndPeople({
      messages: [{
        id: 'msg-repeat', from: 'repeat-contact@example.com', to: ['rep@example.com'], subject: 'Repeat me',
        dateIso: new Date().toUTCString(),
      }],
    });

    await gmailSyncGET(req('/api/integrations/gmail/sync'));
    await gmailSyncGET(req('/api/integrations/gmail/sync'));

    const activityRes = await activityGET(req(`/api/leads/${leadId}/activity?brand=cogmap`), { params: Promise.resolve({ id: leadId }) });
    const activityBody = await activityRes.json();
    const gmailEntries = activityBody.activity.filter((e: any) => e.subject === 'Repeat me');
    expect(gmailEntries).toHaveLength(1);
  });

  it('recognizes a physically-identical email already logged via the inbound-webhook path and does not double-log it', async () => {
    await createLeadWithContactEmail('cross-source@example.com');
    await createGmailConnection('cogmap');
    const database = await db();
    const dateIso = new Date().toUTCString();
    const { buildFallbackHash } = await import('../../lib/gmail-sync');
    const sharedHash = buildFallbackHash({ from: 'cross-source@example.com', toCc: ['rep@example.com'], subject: 'Already seen', dateIso: new Date(dateIso).toISOString() });
    await database.collection('activityLog').insertOne({
      leadId: null, tenantId: 'default', brand: 'cogmap', type: 'email-inbound', direction: 'inbound',
      fromAddress: 'cross-source@example.com', toAddresses: ['rep@example.com'], subject: 'Already seen',
      matchedContactKey: null, source: 'inbound-webhook', externalId: 'resend-already-seen',
      fallbackHash: sharedHash, createdAt: new Date(dateIso),
    });

    mockGmailAndPeople({
      messages: [{ id: 'msg-cross-source', from: 'cross-source@example.com', to: ['rep@example.com'], subject: 'Already seen', dateIso }],
    });

    const res = await gmailSyncGET(req('/api/integrations/gmail/sync'));
    const summary = await res.json();
    expect(summary.ingested).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);

    const count = await database.collection('activityLog').countDocuments({ brand: 'cogmap', fallbackHash: sharedHash });
    expect(count).toBe(1);
  });

  it('an expired/revoked connection does not block the run for other brands', async () => {
    await createGmailConnection('seyu');
    mockGmailAndPeople({ messages: [] });
    const res = await gmailSyncGET(req('/api/integrations/gmail/sync'));
    const summary = await res.json();
    expect(res.status).toBe(200);
    expect(summary.processed).toBeGreaterThanOrEqual(2);
  });
});

describe('Google Contacts search and import (issue 216)', () => {
  it('search returns mapped results', async () => {
    await createGoogleContactsConnection('cogmap');
    mockGmailAndPeople({
      contactsSearchResults: [
        { resourceName: 'people/c1', names: [{ displayName: 'Jane Prospect' }], emailAddresses: [{ value: 'jane@prospect.example.com' }] },
      ],
    });

    const res = await contactsSearchGET(req('/api/integrations/google-contacts/search?brand=cogmap&q=jane'));
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ resourceName: 'people/c1', name: 'Jane Prospect', email: 'jane@prospect.example.com' });
  });

  it('returns 404 when Google Contacts is not connected', async () => {
    const res = await contactsSearchGET(req('/api/integrations/google-contacts/search?brand=dvsc&q=jane'));
    expect(res.status).toBe(404);
  });

  it('import adds a new contact via the real lead write path, keeping contactEmails[] in sync', async () => {
    const leadId = await createLeadWithContactEmail('existing@example.com');
    await createGoogleContactsConnection('cogmap');
    mockGmailAndPeople({
      contactsGet: { resourceName: 'people/c2', names: [{ displayName: 'Imported Person' }], emailAddresses: [{ value: 'imported@example.com' }] },
    });

    const res = await importGooglePOST(req(`/api/leads/${leadId}/contacts/import-google?brand=cogmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceName: 'people/c2' }),
    }), { params: Promise.resolve({ id: leadId }) });
    const body = await res.json();
    expect(body.status).toBe('added');
    expect(body.contact.name).toBe('Imported Person');

    const leadDoc = await (await db()).collection('leads').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(leadId) });
    expect(leadDoc!.contactEmails).toContain('imported@example.com');
    expect(leadDoc!.contacts).toHaveLength(2);
  });

  it('re-importing the same person returns already-exists, never a duplicate write', async () => {
    const leadId = await createLeadWithContactEmail('existing-2@example.com');
    await createGoogleContactsConnection('cogmap');
    mockGmailAndPeople({
      contactsGet: { resourceName: 'people/c3', names: [{ displayName: 'Dup Person' }], emailAddresses: [{ value: 'dup@example.com' }] },
    });

    await importGooglePOST(req(`/api/leads/${leadId}/contacts/import-google?brand=cogmap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceName: 'people/c3' }),
    }), { params: Promise.resolve({ id: leadId }) });

    const second = await importGooglePOST(req(`/api/leads/${leadId}/contacts/import-google?brand=cogmap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceName: 'people/c3' }),
    }), { params: Promise.resolve({ id: leadId }) });
    const secondBody = await second.json();
    expect(secondBody.status).toBe('already-exists');

    const leadDoc = await (await db()).collection('leads').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(leadId) });
    expect(leadDoc!.contacts.filter((c: any) => c.email === 'dup@example.com')).toHaveLength(1);
  });
});
