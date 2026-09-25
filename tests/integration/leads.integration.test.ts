import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { NextRequest } from 'next/server';

// Lead ownership (issue: CRM Lead ownership) — ASSIGN and the assignedTo=me/
// assignable-users paths all require a real verified session, which this
// sandbox cannot mint (see tests/integration/helpers/api-request.ts's own
// comment: these tests otherwise authenticate via x-api-key only). Mocked
// here exactly like admin-clients.integration.test.ts and
// duplicate-review-merge.integration.test.ts mock requireSuperAdminSession —
// a clean dependency-boundary mock, not a forged token — so the ownership
// tests below can exercise the real role/ownership business logic end-to-end
// against a real database, not just a 401 check. app/api/leads/route.ts,
// app/api/leads/columns/route.ts, and app/api/leads/assignable-users/route.ts
// each import only resolveSessionFromIdToken from this module (confirmed via
// grep), so mocking that single export is sufficient.
const resolveSessionFromIdTokenMock = vi.fn();
vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: (...args: any[]) => resolveSessionFromIdTokenMock(...args),
}));

let mongod: MongoMemoryServer;
let GET: typeof import('../../app/api/leads/route').GET;
let POST: typeof import('../../app/api/leads/route').POST;
let PATCH: typeof import('../../app/api/leads/route').PATCH;
let columnsGET: typeof import('../../app/api/leads/columns/route').GET;
let assignableUsersGET: typeof import('../../app/api/leads/assignable-users/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/leads/route');
  GET = mod.GET;
  POST = mod.POST;
  PATCH = mod.PATCH;
  columnsGET = (await import('../../app/api/leads/columns/route')).GET;
  assignableUsersGET = (await import('../../app/api/leads/assignable-users/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  resolveSessionFromIdTokenMock.mockReset();
  resolveSessionFromIdTokenMock.mockResolvedValue(null);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

// A request with no x-api-key header at all, so requireBrandAccessApi falls
// through to the session branch and actually invokes the (mocked)
// resolveSessionFromIdToken — req()/buildApiRequest above always injects a
// valid x-api-key unless the caller overrides it, which would short-circuit
// past the session check and defeat the point of the ownership tests below.
function sessionReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

async function leadsDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

async function seedUserAccess(overrides: { ssoUserId: string; email: string; orgAccess: Record<string, 'admin' | 'user'> }) {
  const database = await leadsDb();
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

describe('GET /api/leads', () => {
  it('returns an empty list against a fresh database', async () => {
    const res = await GET(req('/api/leads?brand=cogmap'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.leads).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('POST /api/leads', () => {
  it('creates a lead and it is retrievable via GET', async () => {
    const payload = {
      entity_name: 'Integration Test FC',
      url: 'https://integration-test-fc.example.com',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 8, confidence: 7, ease: 6 },
      contacts: [{ name: 'Ops Contact', email: 'ops@integration-test-fc.example.com', isDecisionMaker: true }],
    };

    const postRes = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(postRes.status).toBe(201);

    const getRes = await GET(req('/api/leads?brand=cogmap'));
    const getBody = await getRes.json();
    expect(getBody.total).toBe(1);
    expect(getBody.leads[0].entity_name).toBe('Integration Test FC');
    // Regression guard: country was validated as required on create but,
    // until this fix, never actually persisted to the document — every
    // created lead silently lost it (2026-07-27, discovered during a bulk
    // CSV import; see CHANGELOG.md).
    expect(getBody.leads[0].country).toBe('US');
    // toMatchObject, not toEqual — a separate, pre-existing background
    // enrichment step (lib/email-verification.ts, lib/title-normalization.ts)
    // asynchronously adds department/seniorityTier/emailVerificationStatus/
    // lastVerifiedAt to a contact after creation, unrelated to what this
    // test controls or is verifying.
    expect(getBody.leads[0].contacts).toHaveLength(1);
    expect(getBody.leads[0].contacts[0]).toMatchObject({
      name: 'Ops Contact', title: '', email: 'ops@integration-test-fc.example.com', phone: '', linkedin: '', role: '', isDecisionMaker: true,
    });
  });

  it('ignores legacy decision_maker_*/contact_phone fields on create rather than storing them (hard cutover, issue #45)', async () => {
    const payload = {
      entity_name: 'Legacy Field FC',
      url: 'https://legacy-field-fc.example.com',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      // A real contacts[] entry, distinct from the legacy fields below —
      // needed to clear the creation-time quality gate (no named contact
      // means an unconditionally-low computed ease, see computeEase() in
      // app/api/leads/route.ts). The assertions below still prove the real
      // point of this test: the legacy fields never get merged into
      // contacts[] as a second, phantom entry.
      contacts: [{ name: 'Real Contact', email: 'real@legacy-field-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
      decision_maker_name: 'Legacy Name',
      decision_maker_contact: 'legacy@legacy-field-fc.example.com',
      contact_phone: '+1-555-000-0000',
    };

    const postRes = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    expect(postBody.lead.decision_maker_name).toBeUndefined();
    expect(postBody.lead.decision_maker_contact).toBeUndefined();
    expect(postBody.lead.contact_phone).toBeUndefined();
    // Exactly the one real contact supplied above — no phantom second entry
    // derived from the legacy fields.
    expect(postBody.lead.contacts).toHaveLength(1);
    expect(postBody.lead.contacts[0].name).toBe('Real Contact');
  });

  it('rejects a payload that fails validation (bad country code)', async () => {
    const payload = {
      entity_name: 'Bad Country FC',
      url: 'https://bad-country-fc.example.com',
      country: 'USA', // must be 2-letter ISO
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
    };

    const res = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(400);
  });

  it('deduplicates a second lead sharing the same fingerprint (url + entity_name + region)', async () => {
    const payload = {
      entity_name: 'Dedup Test FC',
      url: 'https://dedup-test-fc.example.com',
      region: 'US',
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts: [{ name: 'Jordan Smith', email: 'jordan@dedup-test-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
    };

    const first = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(first.status).toBe(201);

    const second = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error).toBe('Duplicate lead detected');
  });
});

// Issue #127 — app/components/AddLeadModal.tsx is the first real UI caller
// of this route (previously only the research agent posted here). It always
// sends a full contact plus lib/create-lead-defaults.ts's
// MANUAL_LEAD_DEFAULT_ICE (impact 5, confidence 5 — ease is independently
// recomputed server-side by computeEase() from the contact/address fields,
// not read from the posted ice.ease) and source: 'manual'. This exercises
// that exact payload shape end-to-end, including the requireBrandAccessApi
// auth swap (this test's x-api-key path stays green, matching what
// docs/ARCHITECTURE.md documents as the backward-compatible machine-caller
// path) and confirms a manually-added lead lands in DISCOVERED rather than
// being auto-qualified.
describe('POST /api/leads — manual Add Lead flow (issue #127)', () => {
  it('creates a manual lead with a full contact, lands in DISCOVERED, and persists source: manual', async () => {
    const payload = {
      entity_name: 'Manually Added FC',
      url: 'https://manually-added-fc.example.com',
      country: 'US',
      region: 'US',
      kanbanColumn: 'DISCOVERED',
      address: '',
      general_contact: '',
      size: '',
      industry: 'Football',
      sport_or_sector: 'Football',
      level_league: '',
      value_proposition: '',
      notes: '',
      tags: [],
      contacts: [{ name: 'Jordan Smith', email: 'jordan@manually-added-fc.example.com', phone: '+1 555 0100', isDecisionMaker: true }],
      ice: { impact: 5, confidence: 5, ease: 5 },
      source: 'manual',
    };

    const res = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('DISCOVERED');
    expect(body.lead.source).toBe('manual');
    expect(body.lead.contacts).toHaveLength(1);
    // Only the fields this test's own payload controls — normalize-lead.ts
    // strips phone formatting and a separate, pre-existing background
    // enrichment step (unrelated to issue #127) adds fields like
    // department/seniorityTier/lastVerifiedAt asynchronously, so a full
    // deep-equal here would be asserting on someone else's behavior.
    expect(body.lead.contacts[0]).toMatchObject({
      name: 'Jordan Smith',
      email: 'jordan@manually-added-fc.example.com',
      isDecisionMaker: true,
    });

    const getRes = await GET(req('/api/leads?brand=cogmap'));
    const getBody = await getRes.json();
    const created = getBody.leads.find((l: any) => l.entity_name === 'Manually Added FC');
    expect(created.kanbanColumn).toBe('DISCOVERED');
  });

  it('still enforces the duplicate-fingerprint check for a second manual submission of the same entity', async () => {
    const payload = {
      entity_name: 'Manual Dup FC',
      url: 'https://manual-dup-fc.example.com',
      country: 'US',
      region: 'US',
      kanbanColumn: 'DISCOVERED',
      contacts: [{ name: 'Alex Rivera', email: 'alex@manual-dup-fc.example.com', phone: '+1 555 0101', isDecisionMaker: true }],
      ice: { impact: 5, confidence: 5, ease: 5 },
      source: 'manual',
    };

    const first = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(first.status).toBe(201);

    const second = await POST(req('/api/leads?brand=cogmap&tenantId=default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(second.status).toBe(409);
  });
});

// Issue #147 — DVSC as a genuine third brand: a full create-then-read
// lifecycle under brand=dvsc, mirroring the cogmap coverage above, proving
// the brand isn't just type-widened but actually functional end-to-end
// (own collection, own write/read path, no cross-brand bleed).
describe('brand=dvsc lead lifecycle', () => {
  it('creates a DVSC lead into its own collection and it is retrievable via GET, isolated from cogmap', async () => {
    const payload = {
      entity_name: 'DVSC Sponsor Prospect Kft.',
      url: 'https://dvsc-sponsor-prospect.example.hu',
      country: 'HU',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 7, confidence: 6, ease: 5 },
      contacts: [{ name: 'Marketing Lead', email: 'marketing@dvsc-sponsor-prospect.example.hu', isDecisionMaker: true }],
    };

    const postRes = await POST(req('/api/leads?brand=dvsc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(postRes.status).toBe(201);

    const dvscGet = await GET(req('/api/leads?brand=dvsc'));
    const dvscBody = await dvscGet.json();
    expect(dvscBody.total).toBe(1);
    expect(dvscBody.leads[0].entity_name).toBe('DVSC Sponsor Prospect Kft.');

    // Isolation: a DVSC-only lead must never appear under CogMap's own
    // collection/read path (dbCollection: 'dvsc_leads' vs 'leads').
    const cogmapGet = await GET(req('/api/leads?brand=cogmap'));
    const cogmapBody = await cogmapGet.json();
    expect(cogmapBody.leads.some((l: any) => l.entity_name === 'DVSC Sponsor Prospect Kft.')).toBe(false);
  });

  it('rejects a genuinely unrecognized brand with 400, never silently falling back to cogmap (issue #147 regression)', async () => {
    const res = await GET(req('/api/leads?brand=not_a_real_brand'));
    expect(res.status).toBe(400);
  });
});

// Lead ownership (issue: CRM Lead ownership) — PATCH .../leads?id=X ASSIGN.
describe('PATCH /api/leads — ASSIGN action (lead ownership)', () => {
  it('requires an authenticated session — an x-api-key-only caller cannot ASSIGN', async () => {
    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Assign No Session FC')),
    }));
    const created = await create.json();

    // req() sends a valid x-api-key, which authorizes requireBrandAccessApi
    // without ever resolving a session — actorId stays undefined.
    const res = await PATCH(req(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'user-1' }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/authenticated session/);
  });

  it('sets assignedTo/assignedToEmail/assignedAt/assignedBy on self-assign and returns them in the response', async () => {
    await seedUserAccess({ ssoUserId: 'assign-user-1', email: 'assign-user-1@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Self Assign FC')),
    }));
    const created = await create.json();

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-user-1', email: 'assign-user-1@test.example.com' });
    const res = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'assign-user-1' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.assignedTo).toBe('assign-user-1');
    expect(body.lead.assignedToEmail).toBe('assign-user-1@test.example.com');
    expect(body.lead.assignedBy).toBe('assign-user-1');
    expect(body.lead.assignedAt).toBeTruthy();
  });

  it('allows an admin to assign a lead to another user', async () => {
    await seedUserAccess({ ssoUserId: 'assign-admin-1', email: 'assign-admin-1@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'assign-target-1', email: 'assign-target-1@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Admin Assign FC')),
    }));
    const created = await create.json();

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-admin-1', email: 'assign-admin-1@test.example.com' });
    const res = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'assign-target-1' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.assignedTo).toBe('assign-target-1');
    expect(body.lead.assignedToEmail).toBe('assign-target-1@test.example.com');
    expect(body.lead.assignedBy).toBe('assign-admin-1');
  });

  // executeLeadAction returns { success: false } for every authorization
  // failure, and the PATCH handler maps that uniformly to 400 for every
  // action (stage-gate failures included) — there is no separate 403 path,
  // so 400 is this route's real, consistent contract, asserted here rather
  // than a 403 the code has never actually returned.
  it('blocks a non-admin from assigning to another user (400) and leaves the document unchanged', async () => {
    await seedUserAccess({ ssoUserId: 'assign-user-2', email: 'assign-user-2@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'assign-target-2', email: 'assign-target-2@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Blocked Assign FC')),
    }));
    const created = await create.json();

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-user-2', email: 'assign-user-2@test.example.com' });
    const res = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'assign-target-2' }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/brand admin/);

    const getRes = await GET(req('/api/leads?brand=cogmap'));
    const getBody = await getRes.json();
    const stillUnassigned = getBody.leads.find((l: any) => l.entity_name === 'Blocked Assign FC');
    expect(stillUnassigned.assignedTo ?? null).toBeNull();
  });

  it('allows a non-admin to release (clear) their own assignment', async () => {
    await seedUserAccess({ ssoUserId: 'assign-user-3', email: 'assign-user-3@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Self Release FC')),
    }));
    const created = await create.json();

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-user-3', email: 'assign-user-3@test.example.com' });
    const assignRes = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'assign-user-3' }),
    }));
    expect(assignRes.status).toBe(200);

    const releaseRes = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: null }),
    }));
    expect(releaseRes.status).toBe(200);
    const releaseBody = await releaseRes.json();
    expect(releaseBody.lead.assignedTo ?? null).toBeNull();
    expect(releaseBody.lead.assignedToEmail ?? null).toBeNull();
  });

  it("blocks a non-admin from clearing someone else's assignment (400)", async () => {
    await seedUserAccess({ ssoUserId: 'assign-admin-2', email: 'assign-admin-2@test.example.com', orgAccess: { cogmap: 'admin' } });
    await seedUserAccess({ ssoUserId: 'assign-user-4', email: 'assign-user-4@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'assign-target-4', email: 'assign-target-4@test.example.com', orgAccess: { cogmap: 'user' } });

    const create = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Blocked Release FC')),
    }));
    const created = await create.json();

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-admin-2', email: 'assign-admin-2@test.example.com' });
    await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'assign-target-4' }),
    }));

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assign-user-4', email: 'assign-user-4@test.example.com' });
    const res = await PATCH(sessionReq(`/api/leads?id=${created.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: null }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/brand admin/);
  });
});

describe('GET /api/leads and /api/leads/columns — assignedTo filter (lead ownership)', () => {
  it("assignedTo=me returns only the authenticated caller's leads (list view)", async () => {
    await seedUserAccess({ ssoUserId: 'filter-user-1', email: 'filter-user-1@test.example.com', orgAccess: { cogmap: 'user' } });

    const mine = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('My Filtered Lead FC')),
    }));
    const mineBody = await mine.json();
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'filter-user-1', email: 'filter-user-1@test.example.com' });
    await PATCH(sessionReq(`/api/leads?id=${mineBody.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'filter-user-1' }),
    }));

    await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Not My Filtered Lead FC')),
    }));

    const res = await GET(sessionReq('/api/leads?brand=cogmap&assignedTo=me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('My Filtered Lead FC');
    expect(names).not.toContain('Not My Filtered Lead FC');
  });

  it('assignedTo=me scopes the kanban column view the same way', async () => {
    await seedUserAccess({ ssoUserId: 'filter-user-2', email: 'filter-user-2@test.example.com', orgAccess: { cogmap: 'user' } });

    const mine = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('My Column Lead FC')),
    }));
    const mineBody = await mine.json();
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'filter-user-2', email: 'filter-user-2@test.example.com' });
    await PATCH(sessionReq(`/api/leads?id=${mineBody.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'filter-user-2' }),
    }));

    await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Not My Column Lead FC')),
    }));

    const res = await columnsGET(sessionReq('/api/leads/columns?brand=cogmap&column=DISCOVERED&assignedTo=me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('My Column Lead FC');
    expect(names).not.toContain('Not My Column Lead FC');
  });

  it('assignedTo=unassigned matches both a legacy document with no assignedTo field and one explicitly cleared via ASSIGN', async () => {
    await seedUserAccess({ ssoUserId: 'filter-user-3', email: 'filter-user-3@test.example.com', orgAccess: { cogmap: 'user' } });

    // Legacy: never touched by ASSIGN, so it has no assignedTo field at all.
    await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Legacy Unassigned FC')),
    }));

    // Explicitly cleared: assignedTo: null is a real stored field, not an
    // absent one — the two must both match the same filter (see
    // resolveAssignedToFilter's own regression-guard unit test).
    const cleared = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Explicitly Cleared FC')),
    }));
    const clearedBody = await cleared.json();
    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'filter-user-3', email: 'filter-user-3@test.example.com' });
    await PATCH(sessionReq(`/api/leads?id=${clearedBody.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'filter-user-3' }),
    }));
    await PATCH(sessionReq(`/api/leads?id=${clearedBody.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: null }),
    }));

    // Still-assigned: must NOT show up in the unassigned filter.
    const assigned = await POST(req('/api/leads?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadPayload('Still Assigned FC')),
    }));
    const assignedBody = await assigned.json();
    await PATCH(sessionReq(`/api/leads?id=${assignedBody.lead._id}&brand=cogmap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ASSIGN', assignedTo: 'filter-user-3' }),
    }));

    const res = await GET(req('/api/leads?brand=cogmap&assignedTo=unassigned'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.leads.map((l: any) => l.entity_name);
    expect(names).toContain('Legacy Unassigned FC');
    expect(names).toContain('Explicitly Cleared FC');
    expect(names).not.toContain('Still Assigned FC');
  });
});

describe('GET /api/leads/assignable-users (lead ownership)', () => {
  it("returns only brand-scoped users, plus the caller's own resolved role", async () => {
    await seedUserAccess({ ssoUserId: 'assignable-caller', email: 'assignable-caller@test.example.com', orgAccess: { cogmap: 'user' } });
    await seedUserAccess({ ssoUserId: 'assignable-peer', email: 'assignable-peer@test.example.com', orgAccess: { cogmap: 'admin' } });
    // Only dvsc access — must not appear in a cogmap-scoped listing.
    await seedUserAccess({ ssoUserId: 'assignable-other-brand', email: 'assignable-other-brand@test.example.com', orgAccess: { dvsc: 'user' } });

    resolveSessionFromIdTokenMock.mockResolvedValue({ sub: 'assignable-caller', email: 'assignable-caller@test.example.com' });
    const res = await assignableUsersGET(sessionReq('/api/leads/assignable-users?brand=cogmap'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.users.map((u: any) => u.ssoUserId);
    expect(ids).toContain('assignable-caller');
    expect(ids).toContain('assignable-peer');
    expect(ids).not.toContain('assignable-other-brand');
    expect(body.callerSsoUserId).toBe('assignable-caller');
    expect(body.callerRole).toBe('user');
  });

  it('rejects an unauthenticated caller (401)', async () => {
    resolveSessionFromIdTokenMock.mockResolvedValue(null);
    const res = await assignableUsersGET(sessionReq('/api/leads/assignable-users?brand=cogmap'));
    expect(res.status).toBe(401);
  });
});
