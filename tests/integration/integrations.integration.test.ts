import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// Third-party integration connection hub (issue #217). These env vars are
// read at MODULE-LEVEL by app/lib/integration-store.ts (GOOGLE_OAUTH_*) and
// lib/integration-crypto.ts (INTEGRATION_CREDENTIALS_ENCRYPTION_KEY), so
// they must be set before those modules are first imported below — the
// same ordering constraint tests/integration/helpers/api-request.ts
// documents for its own TEST_API_KEY/SLG_API_KEY.
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://salesleadgenerator.example.com/api/integrations/oauth/callback';

// requireBrandAccessSession resolves a real session (resolveSessionFromIdToken)
// then checks real org access (getUserAccess/hasAccessToBrand against a real
// database) — this sandbox can't mint a real signed SSO JWT (same documented
// constraint as every other *.integration.test.ts in this repo), so only
// resolveSessionFromIdToken is mocked; org access itself is exercised for
// real via seedUserAccess() below, not bypassed.
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let connectionsGET: typeof import('../../app/api/integrations/connections/route').GET;
let connectGET: typeof import('../../app/api/integrations/[provider]/connect/route').GET;
let connectPOST: typeof import('../../app/api/integrations/[provider]/connect/route').POST;
let callbackGET: typeof import('../../app/api/integrations/oauth/callback/route').GET;
let disconnectPOST: typeof import('../../app/api/integrations/connections/[id]/disconnect/route').POST;
let testPOST: typeof import('../../app/api/integrations/connections/[id]/test/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  connectionsGET = (await import('../../app/api/integrations/connections/route')).GET;
  const connectMod = await import('../../app/api/integrations/[provider]/connect/route');
  connectGET = connectMod.GET;
  connectPOST = connectMod.POST;
  callbackGET = (await import('../../app/api/integrations/oauth/callback/route')).GET;
  disconnectPOST = (await import('../../app/api/integrations/connections/[id]/disconnect/route')).POST;
  testPOST = (await import('../../app/api/integrations/connections/[id]/test/route')).POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function integrationsDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const database = await integrationsDb();
  const now = new Date().toISOString();
  await database.collection('sso_user_access').insertOne({
    ssoUserId: overrides.ssoUserId,
    email: overrides.email,
    orgAccess: overrides.orgAccess,
    createdAt: now,
    updatedAt: now,
  });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'admin-1', email: 'admin@test.example.com' });
});

function sessionReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

// Real Google token-endpoint / tokeninfo / revoke responses (200 shapes) and
// a real Calendly GET /users/me response, keyed by URL — a minimal stand-in
// for the real provider per issue #217 §19's own explicit "mocked Google
// token endpoint" / "mocked Calendly endpoint" testing requirement.
function mockGoogleAndCalendly(overrides: { tokenInfoOk?: boolean; calendlyOk?: boolean } = {}) {
  const tokenInfoOk = overrides.tokenInfoOk ?? true;
  const calendlyOk = overrides.calendlyOk ?? true;
  global.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({
        access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: 3600, token_type: 'Bearer',
      }), { status: 200 });
    }
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      return new Response(JSON.stringify({ aud: 'test-google-client-id', expires_in: 3600 }), { status: tokenInfoOk ? 200 : 400 });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      return new Response(null, { status: 200 });
    }
    if (url.startsWith('https://api.calendly.com/users/me')) {
      return new Response(JSON.stringify({ resource: { name: 'Test Calendly User' } }), { status: calendlyOk ? 200 : 401 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as any;
}

describe('OAuth connect -> callback -> connection created (issue 217)', () => {
  it('creates an active connection from a real end-to-end redirect + callback round trip', async () => {
    mockGoogleAndCalendly();
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    const connectRes = await connectGET(
      sessionReq('/api/integrations/google_calendar/connect?brand=cogmap&tenantId=default'),
      { params: Promise.resolve({ provider: 'google_calendar' }) }
    );
    expect(connectRes.status).toBeGreaterThanOrEqual(300);
    expect(connectRes.status).toBeLessThan(400);
    expect(connectRes.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');

    const stateCookie = connectRes.cookies.get('integ_oauth_state')?.value;
    const verifierCookie = connectRes.cookies.get('integ_oauth_verifier')?.value;
    expect(stateCookie).toBeTruthy();
    expect(verifierCookie).toBeTruthy();
    const parsedState = JSON.parse(decodeURIComponent(stateCookie!));

    const callbackRes = await callbackGET(sessionReq(
      `/api/integrations/oauth/callback?code=test-auth-code&state=${encodeURIComponent(parsedState.state)}`,
      { headers: { cookie: `integ_oauth_state=${stateCookie}; integ_oauth_verifier=${verifierCookie}` } }
    ));
    expect(callbackRes.status).toBeGreaterThanOrEqual(300);
    expect(callbackRes.status).toBeLessThan(400);
    expect(callbackRes.headers.get('location')).toContain('connected=google_calendar');
    // Cookies are cleared either way, once the flow completes.
    expect(callbackRes.cookies.get('integ_oauth_state')?.value ?? '').toBe('');

    const listRes = await connectionsGET(sessionReq('/api/integrations/connections?brand=cogmap&tenantId=default'));
    const listBody = await listRes.json();
    expect(listBody.connections).toHaveLength(1);
    expect(listBody.connections[0]).toMatchObject({ provider: 'google_calendar', authMethod: 'oauth2', status: 'active', connectedBy: 'admin-1' });
    expect(listBody.connections[0].encryptedCredentials).toBeUndefined();
  });

  it('rejects a state/cookie mismatch by redirecting with connect_error, never creating a connection', async () => {
    mockGoogleAndCalendly();
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    const connectRes = await connectGET(
      sessionReq('/api/integrations/gmail/connect?brand=cogmap&tenantId=default'),
      { params: Promise.resolve({ provider: 'gmail' }) }
    );
    const stateCookie = connectRes.cookies.get('integ_oauth_state')?.value;
    const verifierCookie = connectRes.cookies.get('integ_oauth_verifier')?.value;

    const callbackRes = await callbackGET(sessionReq(
      `/api/integrations/oauth/callback?code=test-auth-code&state=this-does-not-match`,
      { headers: { cookie: `integ_oauth_state=${stateCookie}; integ_oauth_verifier=${verifierCookie}` } }
    ));
    expect(callbackRes.headers.get('location')).toContain('connect_error=invalid_state');

    const listRes = await connectionsGET(sessionReq('/api/integrations/connections?brand=cogmap&tenantId=default'));
    const connections = (await listRes.json()).connections;
    expect(connections.find((c: any) => c.provider === 'gmail')).toBeUndefined();
  });
});

// Issue #228: the callback used to take brand, tenant, provider and user
// from a plain-JSON cookie the browser could rewrite, and never checked the
// session. It now uses a single-use server-side state record and requires
// the same user, still holding access to that brand.
describe('OAuth callback trusts only the server-side state and the live session (issue 228)', () => {
  async function startConnect(provider: 'google_calendar' | 'gmail' | 'google_contacts', tenantId = 'default') {
    const res = await connectGET(
      sessionReq(`/api/integrations/${provider}/connect?brand=cogmap&tenantId=${tenantId}`),
      { params: Promise.resolve({ provider }) }
    );
    const stateCookie = res.cookies.get('integ_oauth_state')?.value as string;
    const verifierCookie = res.cookies.get('integ_oauth_verifier')?.value as string;
    const { state } = JSON.parse(decodeURIComponent(stateCookie));
    return { state, stateCookie, verifierCookie };
  }

  function callback(state: string, stateCookie: string, verifierCookie: string) {
    return callbackGET(sessionReq(
      `/api/integrations/oauth/callback?code=test-auth-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: `integ_oauth_state=${stateCookie}; integ_oauth_verifier=${verifierCookie}` } }
    ));
  }

  async function connectionsFor(tenantId: string) {
    const database = await integrationsDb();
    return database.collection('integration_connections').find({ tenantId }).toArray();
  }

  beforeEach(async () => {
    mockGoogleAndCalendly();
    const database = await integrationsDb();
    await database.collection('sso_user_access').deleteMany({ ssoUserId: { $in: ['admin-1', 'admin-2'] } });
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'admin-2', email: 'admin2@test.example.com', orgAccess: { cogmap: 'admin' } });
  });

  it('ignores tenant, provider and user written into the cookie', async () => {
    const { state, verifierCookie } = await startConnect('google_contacts', 't228-real');
    const forged = encodeURIComponent(JSON.stringify({
      state, brand: 'cogmap', tenantId: 't228-victim', provider: 'gmail', ssoUserId: 'someone-else',
    }));
    const res = await callback(state, forged, verifierCookie);
    expect(res.headers.get('location')).toContain('connected=google_contacts');
    expect(await connectionsFor('t228-victim')).toHaveLength(0);
    const stored = await connectionsFor('t228-real');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ provider: 'google_contacts', connectedBy: 'admin-1' });
  });

  it('rejects a state that was never issued by the connect route', async () => {
    const forged = encodeURIComponent(JSON.stringify({ state: 'made-up-state', brand: 'cogmap' }));
    const res = await callback('made-up-state', forged, 'any-verifier');
    expect(res.headers.get('location')).toContain('connect_error=invalid_state');
  });

  it('accepts a state only once', async () => {
    const { state, stateCookie, verifierCookie } = await startConnect('google_calendar', 't228-replay');
    expect((await callback(state, stateCookie, verifierCookie)).headers.get('location')).toContain('connected=google_calendar');
    expect((await callback(state, stateCookie, verifierCookie)).headers.get('location')).toContain('connect_error=invalid_state');
  });

  it('redirects with session_expired when there is no session at the callback', async () => {
    const { state, stateCookie, verifierCookie } = await startConnect('gmail', 't228-nosession');
    resolveSessionFromIdTokenMock.mockResolvedValueOnce(null);
    const res = await callback(state, stateCookie, verifierCookie);
    expect(res.headers.get('location')).toContain('connect_error=session_expired');
    expect(await connectionsFor('t228-nosession')).toHaveLength(0);
  });

  it('rejects a callback completed by a different user than the one who started it', async () => {
    const { state, stateCookie, verifierCookie } = await startConnect('gmail', 't228-otheruser');
    resolveSessionFromIdTokenMock.mockResolvedValueOnce({ sub: 'admin-2', email: 'admin2@test.example.com' });
    const res = await callback(state, stateCookie, verifierCookie);
    expect(res.headers.get('location')).toContain('connect_error=forbidden');
    expect(await connectionsFor('t228-otheruser')).toHaveLength(0);
  });

  it('rejects a callback when the user lost access to the brand mid-flow', async () => {
    const { state, stateCookie, verifierCookie } = await startConnect('gmail', 't228-revoked');
    const database = await integrationsDb();
    await database.collection('sso_user_access').updateMany({ ssoUserId: 'admin-1' }, { $set: { orgAccess: { seyu: 'admin' } } });
    try {
      const res = await callback(state, stateCookie, verifierCookie);
      expect(res.headers.get('location')).toContain('connect_error=forbidden');
      expect(await connectionsFor('t228-revoked')).toHaveLength(0);
    } finally {
      await database.collection('sso_user_access').updateMany({ ssoUserId: 'admin-1' }, { $set: { orgAccess: { cogmap: 'admin' } } });
    }
  });
});

describe('API-key connect (Calendly) — verify before store (issue 217)', () => {
  it('rejects an invalid token before it is ever persisted', async () => {
    mockGoogleAndCalendly({ calendlyOk: false });
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    const res = await connectPOST(
      sessionReq('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'cogmap', tenantId: 'default', apiKey: 'bad-token' }),
      }),
      { params: Promise.resolve({ provider: 'calendly' }) }
    );
    expect(res.status).toBe(422);

    const listRes = await connectionsGET(sessionReq('/api/integrations/connections?brand=cogmap&tenantId=default'));
    const connections = (await listRes.json()).connections;
    expect(connections.find((c: any) => c.provider === 'calendly')).toBeUndefined();
  });

  it('verifies a valid token against the real endpoint, then stores it encrypted', async () => {
    mockGoogleAndCalendly({ calendlyOk: true });
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    const res = await connectPOST(
      sessionReq('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'cogmap', tenantId: 'default', apiKey: 'good-token' }),
      }),
      { params: Promise.resolve({ provider: 'calendly' }) }
    );
    expect(res.status).toBe(200);

    const listRes = await connectionsGET(sessionReq('/api/integrations/connections?brand=cogmap&tenantId=default'));
    const connections = (await listRes.json()).connections;
    const calendlyConnection = connections.find((c: any) => c.provider === 'calendly');
    expect(calendlyConnection).toMatchObject({ authMethod: 'api_key', status: 'active', providerAccountLabel: 'Test Calendly User' });
  });
});

describe('cross-brand isolation (issue 217)', () => {
  it('an admin with only cogmap access cannot list, test, or disconnect a seyu connection', async () => {
    mockGoogleAndCalendly();
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    // Create the seyu connection as a different (seyu-admin) actor.
    resolveSessionFromIdTokenMock.mockResolvedValueOnce({ sub: 'seyu-admin', email: 'seyu-admin@test.example.com' });
    await seedUserAccess({ ssoUserId: 'seyu-admin', email: 'seyu-admin@test.example.com', orgAccess: { seyu: 'admin' } });
    await connectPOST(
      sessionReq('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'seyu', tenantId: 'default', apiKey: 'seyu-token' }),
      }),
      { params: Promise.resolve({ provider: 'calendly' }) }
    );

    // Back to the cogmap-only admin for every check below.
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'admin-1', email: 'admin@test.example.com' });

    const listRes = await connectionsGET(sessionReq('/api/integrations/connections?brand=seyu&tenantId=default'));
    expect(listRes.status).toBe(403);

    const seyuConnDb = await (await integrationsDb()).collection('integration_connections').findOne({ brand: 'seyu' });
    expect(seyuConnDb).toBeTruthy();

    const testRes = await testPOST(sessionReq(`/api/integrations/connections/${seyuConnDb!.id}/test`, { method: 'POST' }), { params: Promise.resolve({ id: seyuConnDb!.id }) });
    expect(testRes.status).toBe(403);

    const disconnectRes = await disconnectPOST(sessionReq(`/api/integrations/connections/${seyuConnDb!.id}/disconnect`, { method: 'POST' }), { params: Promise.resolve({ id: seyuConnDb!.id }) });
    expect(disconnectRes.status).toBe(403);
  });
});

describe('unique-index race — two concurrent connects resolve to one document (issue 217)', () => {
  it('upserts onto the same {brand, tenantId, provider} document rather than creating a duplicate', async () => {
    mockGoogleAndCalendly();
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    const attempt = () => connectPOST(
      sessionReq('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'cogmap', tenantId: 'default', apiKey: `token-${Math.random()}` }),
      }),
      { params: Promise.resolve({ provider: 'calendly' }) }
    );

    await Promise.all([attempt(), attempt()]);

    const docs = await (await integrationsDb()).collection('integration_connections').find({ brand: 'cogmap', provider: 'calendly' }).toArray();
    expect(docs).toHaveLength(1);
  });
});

describe('Disconnect and Test (issue 217)', () => {
  async function createCalendlyConnection() {
    await connectPOST(
      sessionReq('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: 'cogmap', tenantId: 'default', apiKey: 'disconnect-me-token' }),
      }),
      { params: Promise.resolve({ provider: 'calendly' }) }
    );
    const doc = await (await integrationsDb()).collection('integration_connections').findOne({ brand: 'cogmap', provider: 'calendly' });
    return doc!.id as string;
  }

  it('disconnect flips status to revoked immediately, unconditionally', async () => {
    mockGoogleAndCalendly();
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    const id = await createCalendlyConnection();

    const res = await disconnectPOST(sessionReq(`/api/integrations/connections/${id}/disconnect`, { method: 'POST' }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);

    const doc = await (await integrationsDb()).collection('integration_connections').findOne({ id });
    expect(doc!.status).toBe('revoked');
    expect(doc!.revokedAt).toBeTruthy();
  });

  it('returns 404 disconnecting/testing an unknown connection id', async () => {
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    const disconnectRes = await disconnectPOST(sessionReq('/api/integrations/connections/not-a-real-id/disconnect', { method: 'POST' }), { params: Promise.resolve({ id: 'not-a-real-id' }) });
    expect(disconnectRes.status).toBe(404);
    const testRes = await testPOST(sessionReq('/api/integrations/connections/not-a-real-id/test', { method: 'POST' }), { params: Promise.resolve({ id: 'not-a-real-id' }) });
    expect(testRes.status).toBe(404);
  });

  it('test re-verifies against the real provider and updates lastVerifiedAt/status on success', async () => {
    mockGoogleAndCalendly({ calendlyOk: true });
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    const id = await createCalendlyConnection();

    const res = await testPOST(sessionReq(`/api/integrations/connections/${id}/test`, { method: 'POST' }), { params: Promise.resolve({ id }) });
    const body = await res.json();
    expect(body.status).toBe('active');

    const doc = await (await integrationsDb()).collection('integration_connections').findOne({ id });
    expect(doc!.lastVerifiedAt).toBeTruthy();
  });

  it('a revoked-at-the-provider connection surfaces as status error on Test, never a silent pass', async () => {
    mockGoogleAndCalendly({ calendlyOk: true });
    await seedUserAccess({ ssoUserId: 'admin-1', email: 'admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    const id = await createCalendlyConnection();

    // The provider now rejects the stored token (revoked at Calendly).
    mockGoogleAndCalendly({ calendlyOk: false });
    const res = await testPOST(sessionReq(`/api/integrations/connections/${id}/test`, { method: 'POST' }), { params: Promise.resolve({ id }) });
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.lastSyncError).toBeTruthy();

    const doc = await (await integrationsDb()).collection('integration_connections').findOne({ id });
    expect(doc!.status).toBe('error');
  });
});
