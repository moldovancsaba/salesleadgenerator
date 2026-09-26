import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #229: PUT /api/settings and POST /api/search-learning accepted any
// verified SSO login, including one nobody had granted a brand to. The real
// requireApiKeyOrSession runs here; only the JWT verification underneath it
// is mocked, since a signed SSO token can't be minted in this sandbox.
const verifyIdTokenMock = vi.fn();
vi.mock('../../lib/sso', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sso')>()),
  verifyIdToken: (...args: any[]) => verifyIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let settingsPUT: typeof import('../../app/api/settings/route').PUT;
let learningPOST: typeof import('../../app/api/search-learning/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  settingsPUT = (await import('../../app/api/settings/route')).PUT;
  learningPOST = (await import('../../app/api/search-learning/route')).POST;
  const clientPromise = (await import('../../lib/mongodb')).default;
  const now = new Date().toISOString();
  await (await clientPromise).db().collection('sso_user_access').insertMany([
    { ssoUserId: 'granted', email: 'granted@test.example.com', orgAccess: { cogmap: 'user' }, createdAt: now, updatedAt: now },
    { ssoUserId: 'ungranted', email: 'ungranted@test.example.com', orgAccess: {}, createdAt: now, updatedAt: now },
  ]);
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function sessionRequest(url: string, init: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: 'sso_id_token=test-token' } });
}

const weights = () => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dragEnabled: true }),
});

describe('PUT /api/settings session rule (issue 229)', () => {
  it('refuses a login with no brand access', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ sub: 'ungranted', email: 'ungranted@test.example.com' });
    expect((await settingsPUT(sessionRequest('/api/settings', weights()))).status).toBe(403);
  });

  it('refuses a login with no access record at all', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ sub: 'never-seen', email: 'never-seen@test.example.com' });
    expect((await settingsPUT(sessionRequest('/api/settings', weights()))).status).toBe(403);
  });

  it('accepts a login with access to a brand', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ sub: 'granted', email: 'granted@test.example.com' });
    expect((await settingsPUT(sessionRequest('/api/settings', weights()))).status).toBe(200);
  });

  it('refuses a request with no session and no key', async () => {
    const res = await settingsPUT(new NextRequest('http://localhost/api/settings', weights()));
    expect(res.status).toBe(401);
  });

  it('still accepts the legacy key', async () => {
    expect((await settingsPUT(buildApiRequest('/api/settings', weights()))).status).toBe(200);
  });
});

describe('POST /api/search-learning input and session rule (issue 229)', () => {
  const post = (body: unknown) => buildApiRequest('/api/search-learning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('refuses a login with no brand access', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ sub: 'ungranted', email: 'ungranted@test.example.com' });
    const res = await learningPOST(sessionRequest('/api/search-learning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'q', outcome: 'ACCEPT' }),
    }));
    expect(res.status).toBe(403);
  });

  it('rejects operator objects where strings are expected', async () => {
    expect((await learningPOST(post({ query: 'q', company: { $ne: null } }))).status).toBe(400);
    expect((await learningPOST(post({ query: { $gt: '' } }))).status).toBe(400);
    expect((await learningPOST(post({ query: 'q', terms: [{ $gt: '' }] }))).status).toBe(400);
    expect((await learningPOST(post({ query: 'q', domain: { $exists: true } }))).status).toBe(400);
  });

  it('rejects an unknown outcome', async () => {
    expect((await learningPOST(post({ query: 'q', outcome: 'MAYBE' }))).status).toBe(400);
  });

  it('accepts a well-formed body', async () => {
    expect((await learningPOST(post({ query: 'football clubs', terms: ['club'], domain: 'example.com', outcome: 'ACCEPT' }))).status).toBe(200);
  });
});
