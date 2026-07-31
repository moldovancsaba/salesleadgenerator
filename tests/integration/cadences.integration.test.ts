import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import type { NextRequest } from 'next/server';

// Issue #124/#149: cadence template CRUD (app/api/cadences) and the
// lead-level enroll/cancel lifecycle (app/api/leads/[id]/cadence). Exercises
// the full loop: create a cadence template, enroll a lead, verify the
// computed stepDueAt, attempt a duplicate enroll (rejected), cancel, and
// re-enroll. Also covers the delete-blocked-while-enrolled safety check
// (issue #149's own edge case).

let mongod: MongoMemoryServer;
let cadencesGET: typeof import('../../app/api/cadences/route').GET;
let cadencesPOST: typeof import('../../app/api/cadences/route').POST;
let cadenceIdGET: typeof import('../../app/api/cadences/[id]/route').GET;
let cadenceIdPUT: typeof import('../../app/api/cadences/[id]/route').PUT;
let cadenceIdDELETE: typeof import('../../app/api/cadences/[id]/route').DELETE;
let leadCadencePOST: typeof import('../../app/api/leads/[id]/cadence/route').POST;
let leadCadenceDELETE: typeof import('../../app/api/leads/[id]/cadence/route').DELETE;
let leadsPATCH: typeof import('../../app/api/leads/route').PATCH;
let leadIdPUT: typeof import('../../app/api/leads/[id]/route').PUT;

beforeAll(async () => {
  mongod = await startTestMongo();
  const cadencesMod = await import('../../app/api/cadences/route');
  cadencesGET = cadencesMod.GET;
  cadencesPOST = cadencesMod.POST;
  const cadenceIdMod = await import('../../app/api/cadences/[id]/route');
  cadenceIdGET = cadenceIdMod.GET;
  cadenceIdPUT = cadenceIdMod.PUT;
  cadenceIdDELETE = cadenceIdMod.DELETE;
  const leadCadenceMod = await import('../../app/api/leads/[id]/cadence/route');
  leadCadencePOST = leadCadenceMod.POST;
  leadCadenceDELETE = leadCadenceMod.DELETE;
  leadsPATCH = (await import('../../app/api/leads/route')).PATCH;
  leadIdPUT = (await import('../../app/api/leads/[id]/route')).PUT;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

async function seedLead(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection('leads').insertOne({
    entity_name: entityName,
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

async function createCadence(body: Record<string, unknown>, brand = 'cogmap'): Promise<{ status: number; body: any }> {
  const res = await cadencesPOST(req(`/api/cadences?brand=${brand}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

async function seedSeyuLead(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection('seyu_leads').insertOne({
    entity_name: entityName,
    tenantId: 'default',
    kanbanColumn: 'DISCOVERED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

function patchReq(id: string, body: Record<string, unknown>) {
  return req(`/api/leads?brand=cogmap&tenantId=default&id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...body }),
  });
}

describe('POST /api/cadences (issue #149)', () => {
  it('rejects a cadence with no name/steps', async () => {
    const { status, body } = await createCadence({});
    expect(status).toBe(400);
    expect(body.error).toContain('name is required');
    expect(body.error).toContain('at least one step is required');
  });

  it('creates a cadence with sanitized steps', async () => {
    const { status, body } = await createCadence({
      name: 'Outbound v1',
      steps: [
        { channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' },
        { channel: 'linkedin', waitDaysAfterPrevious: 3, reminderNote: 'Connect on LinkedIn' },
        { channel: 'sms', waitDaysAfterPrevious: 1 },
      ],
    });
    expect(status).toBe(201);
    expect(body.name).toBe('Outbound v1');
    expect(body.enabled).toBe(false);
    // the invalid 'sms' step is dropped, not rejected wholesale
    expect(body.steps).toHaveLength(2);
    expect(body.steps.map((s: any) => s.channel)).toEqual(['email', 'linkedin']);
  });
});

describe('GET /api/cadences (issue #149)', () => {
  it('lists cadences scoped to brand and tenant', async () => {
    await createCadence({ name: 'Brand Scoped Cadence', steps: [{ channel: 'call' }] });
    const res = await cadencesGET(req('/api/cadences?brand=cogmap&tenantId=default'));
    const body = await res.json();
    expect(body.cadences.some((c: any) => c.name === 'Brand Scoped Cadence')).toBe(true);
  });
});

describe('PUT /api/cadences/[id] (issue #149)', () => {
  it('partially updates only the provided fields', async () => {
    const created = await createCadence({ name: 'Editable Cadence', steps: [{ channel: 'call' }] });
    const id = created.body.id;

    const res = await cadenceIdPUT(
      req(`/api/cadences/${id}?brand=cogmap&tenantId=default`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ id }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.name).toBe('Editable Cadence');
  });

  it('404s for an id that does not exist', async () => {
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await cadenceIdPUT(
      req(`/api/cadences/${fakeId}?brand=cogmap&tenantId=default`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ id: fakeId }) }
    );
    expect(res.status).toBe(404);
  });
});

describe('Lead enroll/cancel lifecycle (issue #149)', () => {
  it('enrolls a lead, computing stepDueAt from the first step\'s own wait', async () => {
    const created = await createCadence({
      name: 'Enroll Test Cadence',
      steps: [
        { channel: 'email', waitDaysAfterPrevious: 2, templateId: 'tpl-enroll-1' },
        { channel: 'call', waitDaysAfterPrevious: 5 },
      ],
    });
    const cadenceId = created.body.id;
    const leadId = await seedLead('Enroll Target Co');

    const res = await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.activeCadence.cadenceId).toBe(cadenceId);
    expect(body.activeCadence.currentStepIndex).toBe(0);
    expect(new Date(body.activeCadence.stepDueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a second enroll while already enrolled (one active cadence at a time)', async () => {
    const created = await createCadence({ name: 'Double Enroll Cadence', steps: [{ channel: 'call' }] });
    const cadenceId = created.body.id;
    const leadId = await seedLead('Double Enroll Co');

    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const second = await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(second.status).toBe(409);
  });

  it('404s enrolling into a cadence that does not exist', async () => {
    const leadId = await seedLead('Bad Cadence Co');
    const res = await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: '507f1f77bcf86cd799439011' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(404);
  });

  it('cancel clears activeCadence, allowing re-enrollment afterward', async () => {
    const created = await createCadence({ name: 'Cancel Then Reenroll Cadence', steps: [{ channel: 'call' }] });
    const cadenceId = created.body.id;
    const leadId = await seedLead('Cancel Reenroll Co');

    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const cancelRes = await leadCadenceDELETE(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(cancelRes.status).toBe(200);

    const reEnrollRes = await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(reEnrollRes.status).toBe(200);
  });

  it('cancelling a lead with no active cadence is a no-op success', async () => {
    const leadId = await seedLead('Never Enrolled Co');
    const res = await leadCadenceDELETE(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/cadences/[id] blocked while leads are enrolled (issue #149)', () => {
  it('returns 409 when a lead is actively enrolled, and succeeds after cancellation', async () => {
    const created = await createCadence({ name: 'In Use Cadence', steps: [{ channel: 'call' }] });
    const cadenceId = created.body.id;
    const leadId = await seedLead('In Use Co');

    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const blockedRes = await cadenceIdDELETE(
      req(`/api/cadences/${cadenceId}?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: cadenceId }) }
    );
    expect(blockedRes.status).toBe(409);

    await leadCadenceDELETE(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const allowedRes = await cadenceIdDELETE(
      req(`/api/cadences/${cadenceId}?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: cadenceId }) }
    );
    expect(allowedRes.status).toBe(200);
  });
});

describe('GET /api/cadences/[id] (issue #149)', () => {
  it('404s for a malformed id rather than throwing', async () => {
    const res = await cadenceIdGET(
      req('/api/cadences/not-an-object-id?brand=cogmap&tenantId=default'),
      { params: Promise.resolve({ id: 'not-an-object-id' }) }
    );
    expect(res.status).toBe(404);
  });
});

describe('activeCadence auto-cancelled on terminal LOST transitions (review finding, issue #149)', () => {
  it('PATCH ... DECLINE clears an enrolled lead\'s activeCadence', async () => {
    const created = await createCadence({ name: 'Decline Clears Cadence', steps: [{ channel: 'call' }] });
    const leadId = await seedLead('Decline Clears Co');
    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: created.body.id }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const res = await leadsPATCH(patchReq(leadId, { action: 'DECLINE', declineReason: 'OTHER' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.activeCadence).toBeNull();
  });

  it('PATCH ... COLUMN_MOVE into LOST clears an enrolled lead\'s activeCadence', async () => {
    const created = await createCadence({ name: 'Column Move Lost Clears Cadence', steps: [{ channel: 'call' }] });
    const leadId = await seedLead('Column Move Lost Co');
    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: created.body.id }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const res = await leadsPATCH(patchReq(leadId, { action: 'COLUMN_MOVE', kanbanColumn: 'LOST', sortOrder: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.activeCadence).toBeNull();
  });

  it('PUT /api/leads/[id] moving kanbanColumn to LOST clears an enrolled lead\'s activeCadence', async () => {
    const created = await createCadence({ name: 'PUT Lost Clears Cadence', steps: [{ channel: 'call' }] });
    const leadId = await seedLead('PUT Lost Co');
    await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: created.body.id }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );

    const res = await leadIdPUT(
      req(`/api/leads/${leadId}?brand=cogmap&tenantId=default`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': 'integration-test-key' },
        body: JSON.stringify({ kanbanColumn: 'LOST' }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeCadence).toBeNull();
  });

  it('a non-LOST COLUMN_MOVE leaves an enrolled lead\'s activeCadence untouched', async () => {
    const created = await createCadence({ name: 'Non Lost Move Keeps Cadence', steps: [{ channel: 'call' }] });
    const leadId = await seedLead('Non Lost Move Co');
    const enrollRes = await leadCadencePOST(
      req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: created.body.id }),
      }),
      { params: Promise.resolve({ id: leadId }) }
    );
    const enrollBody = await enrollRes.json();

    const res = await leadsPATCH(patchReq(leadId, { action: 'COLUMN_MOVE', kanbanColumn: 'QUALIFIED', sortOrder: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.activeCadence.cadenceId).toBe(enrollBody.activeCadence.cadenceId);
  });
});

describe('Cross-brand cadence enrollment is rejected (review finding, issue #149)', () => {
  it('404s enrolling a CogMap lead into a Seyu cadence in the same tenant', async () => {
    const seyuCadence = await createCadence({ name: 'Seyu Only Cadence', steps: [{ channel: 'call' }] }, 'seyu');
    const cogmapLeadId = await seedLead('Cross Brand Lead Co');

    const res = await leadCadencePOST(
      req(`/api/leads/${cogmapLeadId}/cadence?brand=cogmap&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: seyuCadence.body.id }),
      }),
      { params: Promise.resolve({ id: cogmapLeadId }) }
    );
    expect(res.status).toBe(404);
  });

  it('a Seyu lead can enroll in its own brand\'s cadence', async () => {
    const seyuCadence = await createCadence({ name: 'Seyu Own Cadence', steps: [{ channel: 'call' }] }, 'seyu');
    const seyuLeadId = await seedSeyuLead('Seyu Enroll Co');

    const res = await leadCadencePOST(
      req(`/api/leads/${seyuLeadId}/cadence?brand=seyu&tenantId=default`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: seyuCadence.body.id }),
      }),
      { params: Promise.resolve({ id: seyuLeadId }) }
    );
    expect(res.status).toBe(200);
  });
});

describe('Concurrent enroll requests cannot both win (review finding, issue #149)', () => {
  it('exactly one of two racing enroll requests for the same lead succeeds', async () => {
    const created = await createCadence({ name: 'Race Cadence', steps: [{ channel: 'call' }] });
    const leadId = await seedLead('Race Enroll Co');

    const [first, second] = await Promise.all([
      leadCadencePOST(
        req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cadenceId: created.body.id }),
        }),
        { params: Promise.resolve({ id: leadId }) }
      ),
      leadCadencePOST(
        req(`/api/leads/${leadId}/cadence?brand=cogmap&tenantId=default`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cadenceId: created.body.id }),
        }),
        { params: Promise.resolve({ id: leadId }) }
      ),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('DELETE /api/cadences/[id] enrollment guard counts legacy (tenantId-less) leads (review finding, issue #149)', () => {
  it('blocks deletion when a legacy lead with no tenantId field is enrolled', async () => {
    const created = await createCadence({ name: 'Legacy Tenant Cadence', steps: [{ channel: 'call' }] });
    const cadenceId = created.body.id;

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    await db.collection('leads').insertOne({
      entity_name: 'Legacy Tenant Lead Co',
      // No tenantId field at all — simulates a pre-tenant-field legacy lead.
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts: [],
      activeCadence: { cadenceId, currentStepIndex: 0, stepDueAt: new Date().toISOString(), enrolledAt: new Date().toISOString() },
    });

    const res = await cadenceIdDELETE(
      req(`/api/cadences/${cadenceId}?brand=cogmap&tenantId=default`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: cadenceId }) }
    );
    expect(res.status).toBe(409);
  });
});

describe('validateCadence rejects an email step with no templateId at the API boundary (review finding, issue #149)', () => {
  it('POST /api/cadences 400s for an email step missing templateId', async () => {
    const { status, body } = await createCadence({
      name: 'Missing Template Cadence',
      steps: [{ channel: 'email', waitDaysAfterPrevious: 0 }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain('templateId is required');
  });
});
