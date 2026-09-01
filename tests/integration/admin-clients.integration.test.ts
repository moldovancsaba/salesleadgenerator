import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// requireSuperAdminSession does real SSO JWT verification against a live
// JWKS endpoint — a real signed token can't be fabricated in this sandbox
// (no private key), the same documented constraint as
// admin-session-auth.integration.test.ts. Mocked here (a clean dependency
// boundary, not a forged token) so this file can exercise the real create
// business logic — slug/alias validation and the uniqueness guard are the
// highest-risk part of issue #196 and deserve real DB-backed coverage, not
// just a 401 check, matching the precedent already established in
// duplicate-review-merge.integration.test.ts.
const requireSuperAdminSessionMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
}));

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/admin/clients/route').GET;
let POST: typeof import('../../app/api/admin/clients/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/admin/clients/route');
  GET = mod.GET;
  POST = mod.POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(async () => {
  requireSuperAdminSessionMock.mockReset();
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'test-admin', email: 'admin@test.example.com' });
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  await client.db().collection('brands').deleteMany({});
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

function postBody(body: Record<string, unknown>) {
  return req('/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('auth gate', () => {
  it('GET rejects a request the session check itself rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await GET(req('/api/admin/clients'));
    expect(res.status).toBe(401);
  });

  it('POST rejects a request the session check itself rejects (403, non-super-admin)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/clients — list', () => {
  it('returns the fallback 3 brands when the collection is empty', async () => {
    const res = await GET(req('/api/admin/clients'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brands.map((b: any) => b.slug).sort()).toEqual(['cogmap', 'dvsc', 'seyu']);
  });

  it('reflects a newly created brand', async () => {
    await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD' }));
    const res = await GET(req('/api/admin/clients'));
    const body = await res.json();
    expect(body.brands.map((b: any) => b.slug)).toEqual(['testco']);
  });
});

describe('POST /api/admin/clients — validation', () => {
  it('rejects a missing/invalid slug', async () => {
    const res = await POST(postBody({ slug: '', label: 'TestCo', currency: 'USD' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/slug/i);
  });

  it('rejects a slug starting with a digit or containing invalid characters', async () => {
    const res1 = await POST(postBody({ slug: '1testco', label: 'TestCo', currency: 'USD' }));
    expect(res1.status).toBe(400);
    const res2 = await POST(postBody({ slug: 'test_co', label: 'TestCo', currency: 'USD' }));
    expect(res2.status).toBe(400);
  });

  it('rejects a missing label', async () => {
    const res = await POST(postBody({ slug: 'testco', label: '', currency: 'USD' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/label/i);
  });

  it('rejects an unrecognized currency', async () => {
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'GBP' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/currency/i);
  });
});

describe('POST /api/admin/clients — successful create', () => {
  it('creates a brand with sane derived defaults', async () => {
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.brand.slug).toBe('testco');
    expect(body.brand.dbCollection).toBe('testco_leads');
    expect(body.brand.apiPrefix).toBe('/api/leads');
    expect(body.brand.forecastModel).toBe('dealSizeBand');
    expect(body.brand.aliases).toEqual(['testco']);
    expect(body.brand.ownNameTerms).toEqual(['testco']);
    expect(body.brand.createdBy).toBe('admin@test.example.com');
  });

  it('never lets the client set apiPrefix directly — always /api/leads regardless of what is sent', async () => {
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD', apiPrefix: '/api/something-else' }));
    const body = await res.json();
    expect(body.brand.apiPrefix).toBe('/api/leads');
  });

  it('merges an explicit alias list with the slug itself', async () => {
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD', aliases: ['testcosales'] }));
    const body = await res.json();
    expect(body.brand.aliases.sort()).toEqual(['testco', 'testcosales']);
  });

  it('accepts an optional fromEmail and salesVocabulary', async () => {
    const res = await POST(postBody({
      slug: 'testco', label: 'TestCo', currency: 'EUR',
      fromEmail: 'Sales <sales@testco.example>',
      salesVocabulary: { customerTypes: ['sponsors'], buyerRoles: ['ceo'] },
    }));
    const body = await res.json();
    expect(body.brand.fromEmail).toBe('Sales <sales@testco.example>');
    expect(body.brand.salesVocabulary).toEqual({ customerTypes: ['sponsors'], buyerRoles: ['ceo'] });
  });
});

describe('POST /api/admin/clients — uniqueness', () => {
  it('rejects a duplicate slug with 409', async () => {
    await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD' }));
    const res = await POST(postBody({ slug: 'testco', label: 'TestCo Two', currency: 'EUR' }));
    expect(res.status).toBe(409);
  });

  it('rejects an alias colliding with an existing brand\'s slug, with 409', async () => {
    await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD' }));
    const res = await POST(postBody({ slug: 'other', label: 'Other', currency: 'USD', aliases: ['testco'] }));
    expect(res.status).toBe(409);
  });

  it('rejects an alias colliding with an existing brand\'s own alias, with 409', async () => {
    await POST(postBody({ slug: 'testco', label: 'TestCo', currency: 'USD', aliases: ['testcosales'] }));
    const res = await POST(postBody({ slug: 'other', label: 'Other', currency: 'USD', aliases: ['testcosales'] }));
    expect(res.status).toBe(409);
  });
});
