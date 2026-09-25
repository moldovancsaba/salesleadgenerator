import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Scoped API keys (issue #210) — the admin CRUD routes are
// requireSuperAdminSession-gated, and this file also exercises GET
// /api/leads (via requireBrandAccessApi's session-fallback branch), which
// imports resolveSessionFromIdToken from the same module. Neither can be
// satisfied with a real signed SSO JWT in this sandbox (same documented
// constraint as teams.integration.test.ts, which mocks both exports for
// exactly this reason). Mocked here identically — a clean dependency
// boundary, not a forged token — so these tests exercise the real
// key-issuance/revocation/auth logic against a real database.
const requireSuperAdminSessionMock = vi.fn();
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let keysGET: typeof import('../../app/api/admin/api-keys/route').GET;
let keysPOST: typeof import('../../app/api/admin/api-keys/route').POST;
let keyDELETE: typeof import('../../app/api/admin/api-keys/[id]/route').DELETE;
let leadsGET: typeof import('../../app/api/leads/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const keysMod = await import('../../app/api/admin/api-keys/route');
  keysGET = keysMod.GET;
  keysPOST = keysMod.POST;
  keyDELETE = (await import('../../app/api/admin/api-keys/[id]/route')).DELETE;
  leadsGET = (await import('../../app/api/leads/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  requireSuperAdminSessionMock.mockReset();
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'super-admin-1', email: 'super-admin@test.example.com' });
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

async function createKey(brand: string, name: string, scope: 'read' | 'read-write') {
  const res = await keysPOST(req('/api/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, name, scopes: [scope] }),
  }));
  expect(res.status).toBe(201);
  return res.json();
}

describe('POST/GET /api/admin/api-keys (issue 210)', () => {
  it('rejects a request the super-admin session check itself rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await keysGET(req('/api/admin/api-keys?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('is never x-api-key-accessible — a valid scoped key cannot substitute for a super-admin session (issue 210 §17)', async () => {
    const created = await createKey('cogmap', 'Should Not Grant Admin Access', 'read-write');
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await keysGET(new NextRequest('http://localhost/api/admin/api-keys?brand=cogmap', {
      headers: { 'x-api-key': created.rawKey },
    }));
    expect(res.status).toBe(401);
  });

  it('creates a key, returns the raw key exactly once, and never returns hashedKey', async () => {
    const body = await createKey('cogmap', 'research-agent-cogmap', 'read');
    expect(body.rawKey).toMatch(/^slg_/);
    expect(body.key.hashedKey).toBeUndefined();
    expect(body.key.name).toBe('research-agent-cogmap');
    expect(body.key.brand).toBe('cogmap');
    expect(body.key.scopes).toEqual(['read']);
    expect(body.key.revokedAt).toBeNull();
  });

  it('rejects invalid input (missing name) with 400', async () => {
    const res = await keysPOST(req('/api/admin/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: '  ', scopes: ['read'] }),
    }));
    expect(res.status).toBe(400);
  });

  it('lists keys scoped to the requested brand only, and never includes hashedKey', async () => {
    await createKey('cogmap', 'Cogmap Isolation Key', 'read');
    await createKey('seyu', 'Seyu Isolation Key', 'read');

    const res = await keysGET(req('/api/admin/api-keys?brand=cogmap'));
    const body = await res.json();
    const names = body.keys.map((k: any) => k.name);
    expect(names).toContain('Cogmap Isolation Key');
    expect(names).not.toContain('Seyu Isolation Key');
    for (const key of body.keys) expect(key.hashedKey).toBeUndefined();
  });
});

describe('DELETE /api/admin/api-keys/[id] (issue 210)', () => {
  it('revokes an active key', async () => {
    const created = await createKey('cogmap', 'Revoke Me', 'read');
    const res = await keyDELETE(req(`/api/admin/api-keys/${created.key.id}?brand=cogmap`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.key.id }),
    });
    expect(res.status).toBe(204);

    const listRes = await keysGET(req('/api/admin/api-keys?brand=cogmap'));
    const listBody = await listRes.json();
    const revoked = listBody.keys.find((k: any) => k.id === created.key.id);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await keyDELETE(req('/api/admin/api-keys/not-a-real-id?brand=cogmap', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'not-a-real-id' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an already-revoked key (no double revoke)', async () => {
    const created = await createKey('cogmap', 'Double Revoke', 'read');
    await keyDELETE(req(`/api/admin/api-keys/${created.key.id}?brand=cogmap`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.key.id }),
    });
    const second = await keyDELETE(req(`/api/admin/api-keys/${created.key.id}?brand=cogmap`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.key.id }),
    });
    expect(second.status).toBe(404);
  });
});

// End-to-end: a scoped key authenticating against a real
// requireBrandAccessApi-gated production route (GET /api/leads), proving
// the extension in lib/require-brand-access-api.ts actually works, not just
// the pure decision logic it calls into.
describe('scoped key end-to-end against GET /api/leads (issue 210)', () => {
  it('authorizes a matching, correctly-scoped key', async () => {
    const created = await createKey('cogmap', 'E2E Read Key', 'read');
    const res = await leadsGET(new NextRequest('http://localhost/api/leads?brand=cogmap', {
      headers: { 'x-api-key': created.rawKey },
    }));
    expect(res.status).toBe(200);
  });

  it('rejects a key scoped to a different brand with 403', async () => {
    const created = await createKey('seyu', 'E2E Wrong Brand Key', 'read');
    const res = await leadsGET(new NextRequest('http://localhost/api/leads?brand=cogmap', {
      headers: { 'x-api-key': created.rawKey },
    }));
    expect(res.status).toBe(403);
  });

  it('rejects a revoked key with 401', async () => {
    const created = await createKey('cogmap', 'E2E Revoked Key', 'read');
    await keyDELETE(req(`/api/admin/api-keys/${created.key.id}?brand=cogmap`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.key.id }),
    });
    const res = await leadsGET(new NextRequest('http://localhost/api/leads?brand=cogmap', {
      headers: { 'x-api-key': created.rawKey },
    }));
    expect(res.status).toBe(401);
  });

  it('falls through to session auth (401, no session) for an unmatched key, exactly like any other bogus x-api-key', async () => {
    const res = await leadsGET(new NextRequest('http://localhost/api/leads?brand=cogmap', {
      headers: { 'x-api-key': 'slg_totally-unknown-key' },
    }));
    expect(res.status).toBe(401);
  });
});
