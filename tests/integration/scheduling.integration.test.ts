import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Meeting scheduler (issue #207), built on issue #217's connection hub.
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://salesleadgenerator.example.com/api/integrations/oauth/callback';

let mongod: MongoMemoryServer;
let availabilityGET: typeof import('../../app/api/schedule/[brand]/availability/route').GET;
let bookPOST: typeof import('../../app/api/schedule/[brand]/book/route').POST;
let settingsGET: typeof import('../../app/api/scheduling-settings/[brand]/route').GET;
let settingsPUT: typeof import('../../app/api/scheduling-settings/[brand]/route').PUT;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let linkPOST: typeof import('../../app/api/leads/[id]/scheduling-link/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  availabilityGET = (await import('../../app/api/schedule/[brand]/availability/route')).GET;
  bookPOST = (await import('../../app/api/schedule/[brand]/book/route')).POST;
  const settingsMod = await import('../../app/api/scheduling-settings/[brand]/route');
  settingsGET = settingsMod.GET;
  settingsPUT = settingsMod.PUT;
  leadsPOST = (await import('../../app/api/leads/route')).POST;
  linkPOST = (await import('../../app/api/leads/[id]/scheduling-link/route')).POST;
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

function publicReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

async function db() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

let brandCounter = 0;
// Upsert, not insertOne — this test file calls it more than once for the
// same brand across different describe blocks, and a raw insertOne would
// either violate the real {brand,tenantId,provider} unique index (once
// ensureIntegrationConnectionIndexes has run) or, before that index exists
// in a fresh test DB, silently create more than one connection document
// for the same brand — neither of which reflects real production
// behavior, where a Reconnect always upserts onto the same document.
async function createGoogleCalendarConnection(brand: string) {
  const { encryptCredentials } = await import('../../lib/integration-crypto');
  const database = await db();
  const now = new Date().toISOString();
  await database.collection('integration_connections').updateOne(
    { brand, tenantId: 'default', provider: 'google_calendar' },
    {
      $set: {
        authMethod: 'oauth2',
        encryptedCredentials: encryptCredentials({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
        scopes: ['https://www.googleapis.com/auth/calendar.events'],
        connectedBy: 'admin-1', connectedAt: now, status: 'active', updatedAt: now, revokedAt: null,
        accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      $setOnInsert: { id: `intconn_test_${brand}_cal_${brandCounter++}` },
    },
    { upsert: true }
  );
}

function mockGoogleCalendar(options: { busy?: Array<{ start: string; end: string }>; eventCreateFails?: boolean } = {}) {
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/calendar/v3/freeBusy')) {
      return new Response(JSON.stringify({ calendars: { primary: { busy: options.busy || [] } } }), { status: 200 });
    }
    if (url.includes('/calendar/v3/calendars/primary/events')) {
      if (options.eventCreateFails) return new Response(JSON.stringify({ error: 'conflict' }), { status: 409 });
      return new Response(JSON.stringify({ id: `event-${Math.random().toString(36).slice(2)}` }), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as any;
}

async function setWideOpenAvailability(brand: string) {
  await settingsPUT(req(`/api/scheduling-settings/${brand}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeZone: 'UTC',
      availabilityWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], startMinuteOfDay: 0, endMinuteOfDay: 1439, slotMinutes: 30, bufferMinutes: 0 },
    }),
  }), { params: Promise.resolve({ brand }) });
}

describe('Scheduling settings (issue 207)', () => {
  it('round-trips a saved availability window', async () => {
    await settingsPUT(req('/api/scheduling-settings/cogmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeZone: 'America/New_York', availabilityWindow: { weekdays: [1, 2], startMinuteOfDay: 600, endMinuteOfDay: 900, slotMinutes: 45, bufferMinutes: 15 } }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    const res = await settingsGET(req('/api/scheduling-settings/cogmap'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const body = await res.json();
    expect(body.settings.timeZone).toBe('America/New_York');
    expect(body.settings.availabilityWindow.slotMinutes).toBe(45);
  });

  it('defaults to a reasonable window when nothing has been saved yet', async () => {
    const res = await settingsGET(req('/api/scheduling-settings/seyu'), { params: Promise.resolve({ brand: 'seyu' }) });
    const body = await res.json();
    expect(body.settings.availabilityWindow.weekdays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('GET /api/schedule/[brand]/availability (issue 207)', () => {
  it('returns 404 when no Google Calendar is connected for the brand', async () => {
    const res = await availabilityGET(publicReq('/api/schedule/dvsc/availability'), { params: Promise.resolve({ brand: 'dvsc' }) });
    expect(res.status).toBe(404);
  });

  it('returns real open slots computed against Google freeBusy data', async () => {
    await createGoogleCalendarConnection('cogmap');
    await setWideOpenAvailability('cogmap');
    mockGoogleCalendar({ busy: [] });

    const res = await availabilityGET(publicReq('/api/schedule/cogmap/availability?days=3'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.slots.length).toBeGreaterThan(0);
  });
});

describe('POST /api/schedule/[brand]/book (issue 207)', () => {
  it('books a real slot, logs a meeting-scheduled activity entry, and writes back nextActionDueAt', async () => {
    await createGoogleCalendarConnection('cogmap');
    await setWideOpenAvailability('cogmap');
    mockGoogleCalendar({ busy: [] });

    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Scheduling Test Org', url: 'https://scheduling-test.example.com', country: 'US',
        kanbanColumn: 'DISCOVERED', ice: { impact: 5, confidence: 5, ease: 5 },
        contacts: [{ name: 'Scheduling Contact', email: 'scheduling-contact@example.com', isDecisionMaker: true }],
      }),
    }));
    const leadId = (await leadRes.json()).lead._id;

    // Issue #229: the link carries a per-lead token, not the lead id.
    const linkRes = await linkPOST(req(`/api/leads/${leadId}/scheduling-link?brand=cogmap`, { method: 'POST' }), { params: Promise.resolve({ id: leadId }) });
    expect(linkRes.status).toBe(200);
    const { path } = await linkRes.json();
    expect(path).toMatch(/^\/schedule\/cogmap\?t=[0-9a-f]{32}$/);
    expect(path).not.toContain(leadId);
    const linkToken = new URL(path, 'http://localhost').searchParams.get('t');

    const availRes = await availabilityGET(publicReq('/api/schedule/cogmap/availability?days=3'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const slot = (await availRes.json()).slots[0];

    const bookRes = await bookPOST(publicReq('/api/schedule/cogmap/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: slot.start, slotEnd: slot.end, linkToken, prospectName: 'Prospect Person', prospectEmail: 'prospect@example.com' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(bookRes.status).toBe(200);
    const bookBody = await bookRes.json();
    expect(bookBody.confirmed).toBe(true);

    const database = await db();
    const activityEntry = await database.collection('activityLog').findOne({ leadId, type: 'meeting-scheduled' });
    expect(activityEntry).toBeTruthy();
    expect(activityEntry!.meetingBookedByEmail).toBe('prospect@example.com');

    const { ObjectId } = await import('mongodb');
    const leadDoc = await database.collection('leads').findOne({ _id: ObjectId.createFromHexString(leadId) });
    expect(leadDoc!.nextActionDueAt).toBe(slot.start);
  });

  // Issue #229: an old-style ?leadId= link still books, but a raw id can no
  // longer write onto a lead, since anyone holding one link could guess
  // another lead's id.
  it('books a legacy raw-leadId request without touching that lead', async () => {
    await createGoogleCalendarConnection('cogmap');
    await setWideOpenAvailability('cogmap');
    mockGoogleCalendar({ busy: [] });
    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Guessed Id Org', url: 'https://guessed-id.example.com', country: 'US',
        kanbanColumn: 'DISCOVERED', ice: { impact: 5, confidence: 5, ease: 5 },
        contacts: [{ name: 'Contact Person', email: 'contact@guessed-id.example.com', isDecisionMaker: true }],
      }),
    }));
    const leadId = (await leadRes.json()).lead._id;
    const availRes = await availabilityGET(publicReq('/api/schedule/cogmap/availability?days=3'), { params: Promise.resolve({ brand: 'cogmap' }) });
    const slot = (await availRes.json()).slots[1];

    const bookRes = await bookPOST(publicReq('/api/schedule/cogmap/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: slot.start, slotEnd: slot.end, leadId, linkToken: 'not-a-real-token', prospectName: 'Someone', prospectEmail: 'someone@example.com' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(bookRes.status).toBe(200);

    const database = await db();
    expect(await database.collection('activityLog').findOne({ leadId, type: 'meeting-scheduled' })).toBeNull();
    const { ObjectId } = await import('mongodb');
    const leadDoc = await database.collection('leads').findOne({ _id: ObjectId.createFromHexString(leadId) });
    expect(leadDoc!.nextActionDueAt).toBeUndefined();
  });

  it('rejects an invalid email with 400 before touching Google at all', async () => {
    await createGoogleCalendarConnection('cogmap');
    const res = await bookPOST(publicReq('/api/schedule/cogmap/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: '2026-01-05T09:00:00.000Z', slotEnd: '2026-01-05T09:30:00.000Z', prospectName: 'X', prospectEmail: 'not-an-email' }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });
    expect(res.status).toBe(400);
  });

  it('two concurrent bookings for the identical slot resolve to exactly one success', async () => {
    await createGoogleCalendarConnection('cogmap');
    await setWideOpenAvailability('cogmap');
    mockGoogleCalendar({ busy: [] });

    const availRes = await availabilityGET(publicReq('/api/schedule/cogmap/availability?days=3'), { params: Promise.resolve({ brand: 'cogmap' }) });
    // A later slot, distinct from whichever one the earlier "books a real
    // slot" test already claimed — that claim record's TTL may not have
    // expired yet, and this test cares about a race on a *shared* slot
    // between its own two concurrent attempts, not about colliding with
    // an unrelated, already-settled prior booking.
    const availableSlots = (await availRes.json()).slots;
    const slot = availableSlots[availableSlots.length - 1];

    const attempt = () => bookPOST(publicReq('/api/schedule/cogmap/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: slot.start, slotEnd: slot.end, prospectName: 'Racer', prospectEmail: `racer-${Math.random()}@example.com` }),
    }), { params: Promise.resolve({ brand: 'cogmap' }) });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('gracefully degrades (never a 500) when the connection is missing', async () => {
    const res = await bookPOST(publicReq('/api/schedule/dvsc/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotStart: '2026-01-05T09:00:00.000Z', slotEnd: '2026-01-05T09:30:00.000Z', prospectName: 'X', prospectEmail: 'x@example.com' }),
    }), { params: Promise.resolve({ brand: 'dvsc' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/leads/[id]/scheduling-link (issue 229)', () => {
  it('requires brand access, returns the same token on repeat, and 404s an unknown lead', async () => {
    const leadRes = await leadsPOST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'Link Token Org', url: 'https://link-token.example.com', country: 'US',
        kanbanColumn: 'DISCOVERED', ice: { impact: 5, confidence: 5, ease: 5 },
        contacts: [{ name: 'Contact Person', email: 'contact@link-token.example.com', isDecisionMaker: true }],
      }),
    }));
    const leadId = (await leadRes.json()).lead._id;
    const params = { params: Promise.resolve({ id: leadId }) };

    const anonymous = await linkPOST(new NextRequest(`http://localhost/api/leads/${leadId}/scheduling-link?brand=cogmap`, { method: 'POST' }), params);
    expect(anonymous.status).toBe(401);

    const first = await (await linkPOST(req(`/api/leads/${leadId}/scheduling-link?brand=cogmap`, { method: 'POST' }), { params: Promise.resolve({ id: leadId }) })).json();
    const second = await (await linkPOST(req(`/api/leads/${leadId}/scheduling-link?brand=cogmap`, { method: 'POST' }), { params: Promise.resolve({ id: leadId }) })).json();
    expect(first.path).toBe(second.path);

    const missingId = '0123456789abcdef01234567';
    const missing = await linkPOST(req(`/api/leads/${missingId}/scheduling-link?brand=cogmap`, { method: 'POST' }), { params: Promise.resolve({ id: missingId }) });
    expect(missing.status).toBe(404);
  });
});

describe('Rate limiting (issue 207)', () => {
  it('returns 429 once the per-IP/brand limit is exceeded within the window', async () => {
    await createGoogleCalendarConnection('seyu');
    await setWideOpenAvailability('seyu');
    mockGoogleCalendar({ busy: [] });

    const makeReq = () => availabilityGET(new NextRequest('http://localhost/api/schedule/seyu/availability', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    }), { params: Promise.resolve({ brand: 'seyu' }) });

    let sawRateLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await makeReq();
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    expect(sawRateLimit).toBe(true);
  });
});
