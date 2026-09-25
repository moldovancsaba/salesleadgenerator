import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest, NextResponse } from 'next/server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Team visibility (issue: CRM Team visibility) — team CRUD is
// requireSuperAdminSession-gated and GET /api/leads?assignedTo=team needs a
// real verified session, neither of which this sandbox can fabricate (no
// private key to mint a real signed SSO JWT — the same documented
// constraint as admin-clients.integration.test.ts and
// tests/integration/leads.integration.test.ts's own ASSIGN tests). Both
// exports live in lib/session.ts, so one mock covers both — a clean
// dependency-boundary mock, not a forged token — letting these tests
// exercise the real team/visibility business logic against a real database.
const requireSuperAdminSessionMock = vi.fn();
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireSuperAdminSession: (...args: any[]) => requireSuperAdminSessionMock(...args),
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let teamsGET: typeof import('../../app/api/admin/teams/route').GET;
let teamsPOST: typeof import('../../app/api/admin/teams/route').POST;
let teamPATCH: typeof import('../../app/api/admin/teams/[teamId]/route').PATCH;
let teamDELETE: typeof import('../../app/api/admin/teams/[teamId]/route').DELETE;
let leadsGET: typeof import('../../app/api/leads/route').GET;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let leadsPATCH: typeof import('../../app/api/leads/route').PATCH;

beforeAll(async () => {
  mongod = await startTestMongo();
  const teamsMod = await import('../../app/api/admin/teams/route');
  teamsGET = teamsMod.GET;
  teamsPOST = teamsMod.POST;
  const teamMod = await import('../../app/api/admin/teams/[teamId]/route');
  teamPATCH = teamMod.PATCH;
  teamDELETE = teamMod.DELETE;
  const leadsMod = await import('../../app/api/leads/route');
  leadsGET = leadsMod.GET;
  leadsPOST = leadsMod.POST;
  leadsPATCH = leadsMod.PATCH;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

const ORIGINAL_SUPER_ADMINS = process.env.SSO_SUPER_ADMIN_EMAILS;

beforeEach(() => {
  requireSuperAdminSessionMock.mockReset();
  requireSuperAdminSessionMock.mockResolvedValue({ sub: 'super-admin-1', email: 'super-admin@test.example.com' });
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
  if (ORIGINAL_SUPER_ADMINS === undefined) delete process.env.SSO_SUPER_ADMIN_EMAILS;
  else process.env.SSO_SUPER_ADMIN_EMAILS = ORIGINAL_SUPER_ADMINS;
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

// No x-api-key — forces requireBrandAccessApi through its session branch,
// same helper/reasoning as tests/integration/leads.integration.test.ts.
function sessionReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

async function teamsDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const database = await teamsDb();
  const now = new Date().toISOString();
  await database.collection('sso_user_access').insertOne({
    ssoUserId: overrides.ssoUserId,
    email: overrides.email,
    orgAccess: overrides.orgAccess,
    createdAt: now,
    updatedAt: now,
  });
}

function leadPayload(entityName: string) {
  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    entity_name: entityName,
    url: `https://${slug}.example.com`,
    country: 'US',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [{ name: 'Contact', email: `contact@${slug}.example.com`, isDecisionMaker: true }],
  };
}

async function createLead(entityName: string): Promise<string> {
  const res = await leadsPOST(req('/api/leads?brand=cogmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadPayload(entityName)),
  }));
  const body = await res.json();
  return body.lead._id;
}

async function assignLead(leadId: string, assignedTo: string, actorSub: string, actorEmail: string) {
  // PATCH resolves the session twice per request (once inside
  // requireBrandAccessApi's own brand-access check, once again in the route
  // handler itself for actorId/actorEmail) — mockResolvedValue (not Once)
  // so both calls see the same actor.
  resolveSessionFromIdTokenMock.mockResolvedValue({ sub: actorSub, email: actorEmail });
  const res = await leadsPATCH(sessionReq(`/api/leads?id=${leadId}&brand=cogmap`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ASSIGN', assignedTo }),
  }));
  if (res.status !== 200) {
    throw new Error(`assignLead(${leadId}, ${assignedTo}) failed: ${res.status} ${JSON.stringify(await res.json())}`);
  }
}

describe('POST/GET /api/admin/teams', () => {
  it('rejects a request the super-admin session check itself rejects (401)', async () => {
    requireSuperAdminSessionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Not authenticated' }, { status: 401 }));
    const res = await teamsGET(req('/api/admin/teams?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('rejects a missing/invalid brand on create', async () => {
    const res = await teamsPOST(req('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'not_a_real_brand', name: 'Test Team' }),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty team name', async () => {
    const res = await teamsPOST(req('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: '  ' }),
    }));
    expect(res.status).toBe(400);
  });

  it('creates a team with empty memberIds/managerIds', async () => {
    const res = await teamsPOST(req('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'CRUD Test Team' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.team.brand).toBe('cogmap');
    expect(body.team.name).toBe('CRUD Test Team');
    expect(body.team.memberIds).toEqual([]);
    expect(body.team.managerIds).toEqual([]);
  });

  it('lists only the requested brand\'s teams, never leaking another brand\'s (cross-brand isolation)', async () => {
    await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'CogMap Isolation Team' }),
    }));
    await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'dvsc', name: 'DVSC Isolation Team' }),
    }));

    const cogmapRes = await teamsGET(req('/api/admin/teams?brand=cogmap'));
    const cogmapBody = await cogmapRes.json();
    const cogmapNames = cogmapBody.teams.map((t: any) => t.name);
    expect(cogmapNames).toContain('CogMap Isolation Team');
    expect(cogmapNames).not.toContain('DVSC Isolation Team');
  });
});

describe('PATCH/DELETE /api/admin/teams/[teamId]', () => {
  it('updates name/memberIds/managerIds when every id has signed in at least once', async () => {
    await seedUserAccess({ ssoUserId: 'team-member-1', email: 'member1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'team-manager-1', email: 'manager1@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'Roster Test Team' }),
    }));
    const created = await create.json();

    const res = await teamPATCH(
      req(`/api/admin/teams/${created.team._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Team', memberIds: ['team-member-1'], managerIds: ['team-manager-1'] }),
      }),
      { params: Promise.resolve({ teamId: created.team._id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team.name).toBe('Renamed Team');
    expect(body.team.memberIds).toEqual(['team-member-1']);
    expect(body.team.managerIds).toEqual(['team-manager-1']);
  });

  it('rejects an unknown memberId/managerId with 400 and leaves the team unchanged', async () => {
    const create = await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'Unknown Id Team' }),
    }));
    const created = await create.json();

    const res = await teamPATCH(
      req(`/api/admin/teams/${created.team._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds: ['never-signed-in-user'] }),
      }),
      { params: Promise.resolve({ teamId: created.team._id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/never-signed-in-user/);

    const getRes = await teamsGET(req('/api/admin/teams?brand=cogmap'));
    const getBody = await getRes.json();
    const unchanged = getBody.teams.find((t: any) => t._id === created.team._id);
    expect(unchanged.memberIds).toEqual([]);
  });

  it('404s PATCH/DELETE for a non-existent teamId', async () => {
    const fakeId = '000000000000000000000000';
    const patchRes = await teamPATCH(
      req(`/api/admin/teams/${fakeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      }),
      { params: Promise.resolve({ teamId: fakeId }) }
    );
    expect(patchRes.status).toBe(404);

    const deleteRes = await teamDELETE(req(`/api/admin/teams/${fakeId}`, { method: 'DELETE' }), { params: Promise.resolve({ teamId: fakeId }) });
    expect(deleteRes.status).toBe(404);
  });

  it('deletes a team (204); deleting again 404s', async () => {
    const create = await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'Delete Me Team' }),
    }));
    const created = await create.json();

    const firstDelete = await teamDELETE(req(`/api/admin/teams/${created.team._id}`, { method: 'DELETE' }), { params: Promise.resolve({ teamId: created.team._id }) });
    expect(firstDelete.status).toBe(204);

    const secondDelete = await teamDELETE(req(`/api/admin/teams/${created.team._id}`, { method: 'DELETE' }), { params: Promise.resolve({ teamId: created.team._id }) });
    expect(secondDelete.status).toBe(404);
  });
});

describe('GET /api/leads — assignedTo=team (visibility narrowing)', () => {
  it("a manager sees the union of their own leads and every current member's leads, never an outsider's", async () => {
    await seedUserAccess({ ssoUserId: 'vis-manager-1', email: 'vis-manager-1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'vis-member-1', email: 'vis-member-1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'vis-member-2', email: 'vis-member-2@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'vis-outsider-1', email: 'vis-outsider-1@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await teamsPOST(req('/api/admin/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', name: 'Visibility Team' }),
    }));
    const created = await create.json();
    await teamPATCH(
      req(`/api/admin/teams/${created.team._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerIds: ['vis-manager-1'], memberIds: ['vis-member-1', 'vis-member-2'] }),
      }),
      { params: Promise.resolve({ teamId: created.team._id }) }
    );

    const managerLeadId = await createLead('Manager Own Lead FC');
    await assignLead(managerLeadId, 'vis-manager-1', 'vis-manager-1', 'vis-manager-1@test.example.com');
    const member1LeadId = await createLead('Member One Lead FC');
    await assignLead(member1LeadId, 'vis-member-1', 'vis-member-1', 'vis-member-1@test.example.com');
    const member2LeadId = await createLead('Member Two Lead FC');
    await assignLead(member2LeadId, 'vis-member-2', 'vis-member-2', 'vis-member-2@test.example.com');
    const outsiderLeadId = await createLead('Outsider Lead FC');
    await assignLead(outsiderLeadId, 'vis-outsider-1', 'vis-outsider-1', 'vis-outsider-1@test.example.com');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'vis-manager-1', email: 'vis-manager-1@test.example.com' });
    const res = await leadsGET(sessionReq('/api/leads?brand=cogmap&assignedTo=team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Manager Own Lead FC');
    expect(names).toContain('Member One Lead FC');
    expect(names).toContain('Member Two Lead FC');
    expect(names).not.toContain('Outsider Lead FC');
  });

  it('degrades to exactly "My Leads" for a non-manager plain user, never an error', async () => {
    await seedUserAccess({ ssoUserId: 'vis-nonmanager-1', email: 'vis-nonmanager-1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'vis-outsider-2', email: 'vis-outsider-2@test.example.com', orgAccess: { cogmap: 'user' } });

    const ownLeadId = await createLead('Non-Manager Own Lead FC');
    await assignLead(ownLeadId, 'vis-nonmanager-1', 'vis-nonmanager-1', 'vis-nonmanager-1@test.example.com');
    const otherLeadId = await createLead('Someone Elses Lead FC');
    await assignLead(otherLeadId, 'vis-outsider-2', 'vis-outsider-2', 'vis-outsider-2@test.example.com');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'vis-nonmanager-1', email: 'vis-nonmanager-1@test.example.com' });
    const res = await leadsGET(sessionReq('/api/leads?brand=cogmap&assignedTo=team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Non-Manager Own Lead FC');
    expect(names).not.toContain('Someone Elses Lead FC');
  });

  it('is a no-op (full, unnarrowed brand result set) for a brand admin', async () => {
    await seedUserAccess({ ssoUserId: 'vis-brand-admin-1', email: 'vis-brand-admin-1@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'vis-random-1', email: 'vis-random-1@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'vis-random-2', email: 'vis-random-2@test.example.com', orgAccess: { cogmap: 'user' } });

    const lead1 = await createLead('Admin Noop Lead One FC');
    await assignLead(lead1, 'vis-random-1', 'vis-random-1', 'vis-random-1@test.example.com');
    const lead2 = await createLead('Admin Noop Lead Two FC');
    await assignLead(lead2, 'vis-random-2', 'vis-random-2', 'vis-random-2@test.example.com');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'vis-brand-admin-1', email: 'vis-brand-admin-1@test.example.com' });
    const scoped = await leadsGET(sessionReq('/api/leads?brand=cogmap&assignedTo=team'));
    const scopedBody = await scoped.json();
    const unscoped = await leadsGET(req('/api/leads?brand=cogmap'));
    const unscopedBody = await unscoped.json();
    // Same total as the fully unnarrowed brand listing — a brand admin must
    // never see LESS because of this feature.
    expect(scopedBody.total).toBe(unscopedBody.total);
    const names = scopedBody.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Admin Noop Lead One FC');
    expect(names).toContain('Admin Noop Lead Two FC');
  });

  it('is a no-op (full, unnarrowed brand result set) for a super admin', async () => {
    process.env.SSO_SUPER_ADMIN_EMAILS = 'vis-super-1@test.example.com';
    await seedUserAccess({ ssoUserId: 'vis-super-1', email: 'vis-super-1@test.example.com', orgAccess: {} });
    await seedUserAccess({ ssoUserId: 'vis-random-3', email: 'vis-random-3@test.example.com', orgAccess: { cogmap: 'user' } });

    const lead1 = await createLead('Super Noop Lead FC');
    await assignLead(lead1, 'vis-random-3', 'vis-random-3', 'vis-random-3@test.example.com');

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'vis-super-1', email: 'vis-super-1@test.example.com' });
    const res = await leadsGET(sessionReq('/api/leads?brand=cogmap&assignedTo=team'));
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).toContain('Super Noop Lead FC');
  });

  it('fails safe to a no-match filter when no session is resolvable (x-api-key caller), never every lead', async () => {
    await createLead('Unresolvable Session Lead FC');
    const res = await leadsGET(req('/api/leads?brand=cogmap&assignedTo=team'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leads.map((l: any) => l.entity_name)).not.toContain('Unresolvable Session Lead FC');
  });
});
