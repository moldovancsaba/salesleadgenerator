import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { NextRequest } from 'next/server';

// PATCH/POST/DELETE /api/saved-filters* (issue #214) — every mutating route
// needs a real ssoUserId, which only a verified SSO session carries.
// resolveSessionFromIdToken mocked as a clean dependency boundary, same
// convention as tests/integration/leads-bulk.integration.test.ts's own
// ASSIGN coverage (this sandbox cannot mint a real signed SSO JWT).
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/saved-filters/route').GET;
let POST: typeof import('../../app/api/saved-filters/route').POST;
let idPATCH: typeof import('../../app/api/saved-filters/[id]/route').PATCH;
let idDELETE: typeof import('../../app/api/saved-filters/[id]/route').DELETE;
let importPOST: typeof import('../../app/api/saved-filters/import/route').POST;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/saved-filters/route');
  GET = mod.GET;
  POST = mod.POST;
  const idMod = await import('../../app/api/saved-filters/[id]/route');
  idPATCH = idMod.PATCH;
  idDELETE = idMod.DELETE;
  importPOST = (await import('../../app/api/saved-filters/import/route')).POST;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
});

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const now = new Date().toISOString();
  await client.db().collection('sso_user_access').insertOne({
    ssoUserId: overrides.ssoUserId, email: overrides.email, orgAccess: overrides.orgAccess,
    createdAt: now, updatedAt: now,
  });
}

function asUser(sub: string, email: string) {
  resolveSessionFromIdTokenMock.mockResolvedValue({ sub, email });
}

// No x-api-key — forces requireBrandAccessApi through its session branch,
// same reasoning/helper shape as leads-bulk.integration.test.ts's sessionReq.
function sessionReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/saved-filters — auth (issue 214)', () => {
  it('401s with no session and no x-api-key at all (requireBrandAccessApi itself)', async () => {
    const res = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('401s for a machine (x-api-key) caller — saved filters require a real session, not just brand access', async () => {
    // buildApiRequest injects a valid x-api-key, which satisfies
    // requireBrandAccessApi on its own — this specifically proves the
    // route's own additional session requirement fires independently.
    const res = await GET(buildApiRequest('/api/saved-filters?brand=cogmap'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authenticated session/);
  });

  it('403s for a session with no access to the requested brand', async () => {
    await seedUserAccess({ ssoUserId: 'sf-noaccess-1', email: 'sf-noaccess-1@test.example.com', orgAccess: { seyu: 'user' } });
    asUser('sf-noaccess-1', 'sf-noaccess-1@test.example.com');
    const res = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/saved-filters — create/replace (issue 214)', () => {
  it('creates a new saved filter owned by the caller', async () => {
    await seedUserAccess({ ssoUserId: 'sf-user-1', email: 'sf-user-1@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-user-1', 'sf-user-1@test.example.com');

    const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'US Academies', filter: { region: 'US', industry: 'Academy' } }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.savedFilter.name).toBe('US Academies');
    expect(body.savedFilter.sharedWithBrand).toBe(false);
  });

  it('rejects an empty filter with 400', async () => {
    await seedUserAccess({ ssoUserId: 'sf-user-2', email: 'sf-user-2@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-user-2', 'sf-user-2@test.example.com');

    const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nothing', filter: {} }),
    }));
    expect(res.status).toBe(400);
  });

  it('saving under an existing name replaces it in place (same _id)', async () => {
    await seedUserAccess({ ssoUserId: 'sf-user-3', email: 'sf-user-3@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-user-3', 'sf-user-3@test.example.com');

    const first = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My View', filter: { region: 'US' } }),
    }));
    const firstBody = await first.json();

    const second = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My View', filter: { region: 'CEE' } }),
    }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.savedFilter._id).toBe(firstBody.savedFilter._id);
    expect(secondBody.savedFilter.filter.region).toBe('CEE');
  });

  it('rejects sharedWithBrand: true from a non-admin with 403', async () => {
    await seedUserAccess({ ssoUserId: 'sf-user-4', email: 'sf-user-4@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-user-4', 'sf-user-4@test.example.com');

    const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Team View', filter: { region: 'US' }, sharedWithBrand: true }),
    }));
    expect(res.status).toBe(403);
  });

  it('allows sharedWithBrand: true from a brand admin, visible read-only to a teammate', async () => {
    await seedUserAccess({ ssoUserId: 'sf-admin-1', email: 'sf-admin-1@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'sf-teammate-1', email: 'sf-teammate-1@test.example.com', orgAccess: { cogmap: 'user' } });

    asUser('sf-admin-1', 'sf-admin-1@test.example.com');
    const createRes = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stale ENGAGED over 50K', filter: { region: 'US' }, sharedWithBrand: true }),
    }));
    expect(createRes.status).toBe(201);

    asUser('sf-teammate-1', 'sf-teammate-1@test.example.com');
    const listRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const listBody = await listRes.json();
    const shared = listBody.savedFilters.find((f: any) => f.name === 'Stale ENGAGED over 50K');
    expect(shared).toBeTruthy();
    expect(shared.isMine).toBe(false);
    expect(shared.ownerEmail).toBe('sf-admin-1@test.example.com');
  });
});

describe('GET /api/saved-filters — merge query and brand isolation (issue 214)', () => {
  it('never returns another user\'s non-shared saved filter', async () => {
    await seedUserAccess({ ssoUserId: 'sf-priv-owner', email: 'sf-priv-owner@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'sf-priv-viewer', email: 'sf-priv-viewer@test.example.com', orgAccess: { cogmap: 'user' } });

    asUser('sf-priv-owner', 'sf-priv-owner@test.example.com');
    await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Private View', filter: { region: 'US' } }),
    }));

    asUser('sf-priv-viewer', 'sf-priv-viewer@test.example.com');
    const res = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const body = await res.json();
    expect(body.savedFilters.find((f: any) => f.name === 'Private View')).toBeUndefined();
  });

  it('never returns a same-user saved filter from a different brand', async () => {
    await seedUserAccess({ ssoUserId: 'sf-multibrand-1', email: 'sf-multibrand-1@test.example.com', orgAccess: { cogmap: 'user', seyu: 'user' } });
    asUser('sf-multibrand-1', 'sf-multibrand-1@test.example.com');

    await POST(sessionReq('/api/saved-filters?brand=seyu', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Seyu Only View', filter: { region: 'EU' } }),
    }));

    const res = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const body = await res.json();
    expect(body.savedFilters.find((f: any) => f.name === 'Seyu Only View')).toBeUndefined();
  });

  it('canShare reflects the real caller role', async () => {
    await seedUserAccess({ ssoUserId: 'sf-role-user', email: 'sf-role-user@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'sf-role-admin', email: 'sf-role-admin@test.example.com', orgAccess: { cogmap: 'admin' } });

    asUser('sf-role-user', 'sf-role-user@test.example.com');
    const userRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    expect((await userRes.json()).canShare).toBe(false);

    asUser('sf-role-admin', 'sf-role-admin@test.example.com');
    const adminRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    expect((await adminRes.json()).canShare).toBe(true);
  });
});

describe('PATCH/DELETE /api/saved-filters/[id] — ownership enforcement (issue 214)', () => {
  async function createOwnFilter(ssoUserId: string, email: string, name: string, shared = false) {
    asUser(ssoUserId, email);
    const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filter: { region: 'US' }, sharedWithBrand: shared }),
    }));
    const body = await res.json();
    return body.savedFilter._id as string;
  }

  it('rejects a non-owner PATCH with 403, even a brand admin', async () => {
    await seedUserAccess({ ssoUserId: 'sf-own-1', email: 'sf-own-1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'sf-admin-2', email: 'sf-admin-2@test.example.com', orgAccess: { cogmap: 'admin' } });
    const id = await createOwnFilter('sf-own-1', 'sf-own-1@test.example.com', 'Owner Only View');

    asUser('sf-admin-2', 'sf-admin-2@test.example.com');
    const res = await idPATCH(sessionReq(`/api/saved-filters/${id}?brand=cogmap`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedWithBrand: true }),
    }), idParams(id));
    expect(res.status).toBe(403);
  });

  it('rejects the owner setting sharedWithBrand: true when they are not a brand admin', async () => {
    await seedUserAccess({ ssoUserId: 'sf-own-2', email: 'sf-own-2@test.example.com', orgAccess: { cogmap: 'user' } });
    const id = await createOwnFilter('sf-own-2', 'sf-own-2@test.example.com', 'Own Non Admin View');

    asUser('sf-own-2', 'sf-own-2@test.example.com');
    const res = await idPATCH(sessionReq(`/api/saved-filters/${id}?brand=cogmap`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedWithBrand: true }),
    }), idParams(id));
    expect(res.status).toBe(403);
  });

  it('allows the owning brand admin to share their own filter', async () => {
    await seedUserAccess({ ssoUserId: 'sf-admin-3', email: 'sf-admin-3@test.example.com', orgAccess: { cogmap: 'admin' } });
    const id = await createOwnFilter('sf-admin-3', 'sf-admin-3@test.example.com', 'Admin Own View');

    asUser('sf-admin-3', 'sf-admin-3@test.example.com');
    const res = await idPATCH(sessionReq(`/api/saved-filters/${id}?brand=cogmap`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedWithBrand: true }),
    }), idParams(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.savedFilter.sharedWithBrand).toBe(true);
  });

  it('404s for an id belonging to a different brand', async () => {
    await seedUserAccess({ ssoUserId: 'sf-cross-1', email: 'sf-cross-1@test.example.com', orgAccess: { cogmap: 'user', seyu: 'admin' } });
    const id = await createOwnFilter('sf-cross-1', 'sf-cross-1@test.example.com', 'Cogmap Only View');

    asUser('sf-cross-1', 'sf-cross-1@test.example.com');
    const res = await idPATCH(sessionReq(`/api/saved-filters/${id}?brand=seyu`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedWithBrand: true }),
    }), idParams(id));
    expect(res.status).toBe(404);
  });

  it('rejects a non-owner DELETE with 403', async () => {
    await seedUserAccess({ ssoUserId: 'sf-own-3', email: 'sf-own-3@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'sf-other-1', email: 'sf-other-1@test.example.com', orgAccess: { cogmap: 'user' } });
    const id = await createOwnFilter('sf-own-3', 'sf-own-3@test.example.com', 'Delete Protected View');

    asUser('sf-other-1', 'sf-other-1@test.example.com');
    const res = await idDELETE(sessionReq(`/api/saved-filters/${id}?brand=cogmap`, { method: 'DELETE' }), idParams(id));
    expect(res.status).toBe(403);
  });

  it('allows the owner to delete their own filter, and it is gone from a subsequent GET', async () => {
    await seedUserAccess({ ssoUserId: 'sf-own-4', email: 'sf-own-4@test.example.com', orgAccess: { cogmap: 'user' } });
    const id = await createOwnFilter('sf-own-4', 'sf-own-4@test.example.com', 'Deletable View');

    asUser('sf-own-4', 'sf-own-4@test.example.com');
    const delRes = await idDELETE(sessionReq(`/api/saved-filters/${id}?brand=cogmap`, { method: 'DELETE' }), idParams(id));
    expect(delRes.status).toBe(204);

    const listRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const listBody = await listRes.json();
    expect(listBody.savedFilters.find((f: any) => f._id === id)).toBeUndefined();
  });
});

describe('POST /api/saved-filters — cap eviction at 20 (issue 214)', () => {
  it('drops the oldest of the caller\'s own filters, oldest first, once the cap is exceeded', async () => {
    await seedUserAccess({ ssoUserId: 'sf-cap-1', email: 'sf-cap-1@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-cap-1', 'sf-cap-1@test.example.com');

    for (let i = 0; i < 21; i++) {
      const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Cap View ${i}`, filter: { region: 'US' } }),
      }));
      expect(res.status).toBe(201);
    }

    const res = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const body = await res.json();
    // Filtered to this test's own "Cap View *" filters — the shared-state
    // Mongo instance backing this whole file also carries sharedWithBrand
    // records other describe blocks created earlier, which this same $or
    // query legitimately (and correctly) also returns.
    const names = body.savedFilters.map((f: any) => f.name).filter((n: string) => n.startsWith('Cap View '));
    expect(names).toHaveLength(20);
    expect(names).not.toContain('Cap View 0');
    expect(names).toContain('Cap View 20');
  });

  it('a filter shared to the caller by someone else never counts against their own cap', async () => {
    await seedUserAccess({ ssoUserId: 'sf-cap-admin', email: 'sf-cap-admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'sf-cap-owner', email: 'sf-cap-owner@test.example.com', orgAccess: { cogmap: 'user' } });

    asUser('sf-cap-admin', 'sf-cap-admin@test.example.com');
    await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Shared To Cap Owner', filter: { region: 'US' }, sharedWithBrand: true }),
    }));

    asUser('sf-cap-owner', 'sf-cap-owner@test.example.com');
    // This caller's own count is 0 — a 21st own save would be needed to
    // trigger eviction of an own record, which a shared-to-them record can
    // never be.
    const res = await POST(sessionReq('/api/saved-filters?brand=cogmap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cap Owner Own View', filter: { region: 'CEE' } }),
    }));
    expect(res.status).toBe(201);

    const listRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const listBody = await listRes.json();
    expect(listBody.savedFilters.find((f: any) => f.name === 'Shared To Cap Owner')).toBeTruthy();
    expect(listBody.savedFilters.find((f: any) => f.name === 'Cap Owner Own View')).toBeTruthy();
  });
});

describe('POST /api/saved-filters/import — local migration (issue 214)', () => {
  it('401s for a machine (x-api-key) caller with no session', async () => {
    const req = buildApiRequest('/api/saved-filters/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', filters: [] }),
    });
    const res = await importPOST(req);
    expect(res.status).toBe(401);
  });

  it('imports valid entries, skips invalid ones, and forces sharedWithBrand false regardless of the caller\'s role', async () => {
    await seedUserAccess({ ssoUserId: 'sf-import-admin', email: 'sf-import-admin@test.example.com', orgAccess: { cogmap: 'admin' } });
    asUser('sf-import-admin', 'sf-import-admin@test.example.com');

    const res = await importPOST(sessionReq('/api/saved-filters/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'cogmap',
        filters: [
          { name: 'Imported View A', filter: { region: 'US' } },
          { name: '   ', filter: { region: 'CEE' } },
          { name: 'Imported Empty', filter: {} },
          { name: 'Imported View B', filter: { industry: 'Academy' } },
        ],
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(2);

    const listRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const listBody = await listRes.json();
    const imported = listBody.savedFilters.find((f: any) => f.name === 'Imported View A');
    expect(imported).toBeTruthy();
    expect(imported.sharedWithBrand).toBe(false);
  });

  it('upserts by name — importing the same name twice replaces in place, no duplicate', async () => {
    await seedUserAccess({ ssoUserId: 'sf-import-dup', email: 'sf-import-dup@test.example.com', orgAccess: { cogmap: 'user' } });
    asUser('sf-import-dup', 'sf-import-dup@test.example.com');

    await importPOST(sessionReq('/api/saved-filters/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', filters: [{ name: 'Dup Import View', filter: { region: 'US' } }] }),
    }));
    await importPOST(sessionReq('/api/saved-filters/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', filters: [{ name: 'Dup Import View', filter: { region: 'CEE' } }] }),
    }));

    const listRes = await GET(sessionReq('/api/saved-filters?brand=cogmap'));
    const listBody = await listRes.json();
    const matches = listBody.savedFilters.filter((f: any) => f.name === 'Dup Import View');
    expect(matches).toHaveLength(1);
    expect(matches[0].filter.region).toBe('CEE');
  });
});
