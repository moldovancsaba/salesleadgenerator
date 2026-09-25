import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import type { LeadForSend } from '../../lib/outreach-send';
import type { OutreachTemplate } from '../../app/lib/outreach/default-templates';

// Issue #124/#150: sendAutomatedEmail() is the module that actually sends a
// cadence's email step with no human clicking send. Every scenario the
// issue's own Acceptance Criteria names is covered here against a real
// mongodb-memory-server db — routing failure never calls Resend, a missing
// template never calls Resend, a successful send writes the right
// outreach_logs row, a Resend-side rejection is caught and logged (never
// thrown), and the idempotency key is exactly what the cron scheduler
// (#151) will rely on for retry-safety.

process.env.RESEND_API_KEY = 're_test_placeholder_key';

let mongod: MongoMemoryServer;
let db: Db;
// Issue #195 — sendAutomatedEmail() now calls app/lib/brand.ts's
// getBrandConfig() (for the brand's fromEmail override), which reads
// lib/mongodb.ts's clientPromise — a module-level singleton created from
// process.env.MONGODB_URI at import time (see tests/integration/helpers/
// mongo-test-server.ts's own header comment). A static top-of-file import
// of sendAutomatedEmail would resolve that chain before startTestMongo()
// below ever sets MONGODB_URI, permanently caching an unconfigured client
// for this test file — so it's imported dynamically here instead, after
// the URI is set, the same pattern every route-handler integration test
// in this repo already uses for exactly this reason.
let sendAutomatedEmail: typeof import('../../lib/outreach-send').sendAutomatedEmail;
let sendManualEmail: typeof import('../../lib/outreach-send').sendManualEmail;

beforeAll(async () => {
  mongod = await startTestMongo();
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  db = client.db();
  const outreachSendMod = await import('../../lib/outreach-send');
  sendAutomatedEmail = outreachSendMod.sendAutomatedEmail;
  sendManualEmail = outreachSendMod.sendManualEmail;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// Mocks Resend's real /emails send endpoint at the fetch layer (verified
// against node_modules/resend/dist/index.mjs — POST https://api.resend.com/emails),
// matching the exact same "mock the SDK's real network boundary, not its
// internals" convention tests/integration/inbound-email-webhook.integration.test.ts
// already established for the receiving endpoint.
function mockSendApi(response: { id: string } | { errorStatus: number; message?: string }) {
  const original = global.fetch;
  let capturedRequest: { url: string; body: any; headers: Record<string, string> } | null = null;
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/emails')) {
      // init.headers may arrive as a Headers instance, a plain object, or an
      // array of tuples depending on how the SDK's own fetch wrapper builds
      // the request — normalize via the Headers constructor so lookups below
      // work regardless of the shape actually used at runtime.
      const normalizedHeaders: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        normalizedHeaders[key] = value;
      });
      capturedRequest = {
        url,
        body: init?.body ? JSON.parse(init.body) : null,
        headers: normalizedHeaders,
      };
      if ('errorStatus' in response) {
        return new Response(JSON.stringify({ name: 'validation_error', message: response.message || 'rejected' }), {
          status: response.errorStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: response.id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(input, init);
  });
  return () => capturedRequest;
}

function makeLead(overrides: Partial<LeadForSend> = {}): LeadForSend {
  return {
    _id: `lead-${Math.random().toString(36).slice(2)}`,
    entity_name: 'Acme Academy',
    contacts: [{ name: 'Jamie Rivera', email: 'jamie@acme-academy.com', isDecisionMaker: true }],
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<OutreachTemplate> = {}): OutreachTemplate {
  return {
    id: 'tpl-1',
    name: 'Intro',
    channel: 'email',
    industry: 'Academy',
    subject: 'Hello {entity_name}',
    body: 'Hi {contact_name}, reaching out to {entity_name}.',
    variables: ['entity_name', 'contact_name'],
    ...overrides,
  };
}

function context(overrides: Partial<{ brand: string; tenantId: string; cadenceId: string; stepIndex: number }> = {}) {
  return { brand: 'cogmap', tenantId: 'default', cadenceId: 'cad-1', stepIndex: 0, ...overrides };
}

async function latestLog(leadId: string) {
  return db.collection('outreach_logs').findOne({ leadId }, { sort: { createdAt: -1 } });
}

describe('sendAutomatedEmail — routing failure never calls Resend (issue #150)', () => {
  it('returns sent:false and writes a routingAllowed:false log when the lead has no decision-maker email', async () => {
    const getCaptured = mockSendApi({ id: 'should-not-be-called' });
    const lead = makeLead({ contacts: [{ name: 'No Email Guy', isDecisionMaker: true }] });

    const result = await sendAutomatedEmail(db, lead, makeTemplate(), context());

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('email');
    expect(getCaptured()).toBeNull();

    const log = await latestLog(lead._id);
    expect(log?.routingAllowed).toBe(false);
    expect(log?.sentAutomatically).toBe(true);
    expect(log?.cadenceId).toBe('cad-1');
    expect(log?.stepIndex).toBe(0);
  });
});

describe('sendAutomatedEmail — missing template (issue #150)', () => {
  it('returns sent:false with reason "template not found" and never calls Resend', async () => {
    const getCaptured = mockSendApi({ id: 'should-not-be-called' });
    const lead = makeLead();

    const result = await sendAutomatedEmail(db, lead, null, context());

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('template not found');
    expect(getCaptured()).toBeNull();

    const log = await latestLog(lead._id);
    expect(log?.routingAllowed).toBe(false);
    expect(log?.routingReason).toBe('template not found');
  });
});

describe('sendAutomatedEmail — successful send (issue #150)', () => {
  it('sends via Resend with the interpolated subject/body and writes a success log', async () => {
    const getCaptured = mockSendApi({ id: 'resend-email-id-1' });
    const lead = makeLead();

    const result = await sendAutomatedEmail(db, lead, makeTemplate(), context());

    expect(result.sent).toBe(true);
    expect(result.reason).toBeUndefined();

    const captured = getCaptured();
    expect(captured?.body.subject).toBe('Hello Acme Academy');
    expect(captured?.body.text).toBe('Hi Jamie Rivera, reaching out to Acme Academy.');
    expect(captured?.body.to).toBe('jamie@acme-academy.com');
    expect(captured?.body.from).toBe('cogmap@haho.ai');

    const log = await latestLog(lead._id);
    expect(log?.routingAllowed).toBe(true);
    expect(log?.subject).toBe('Hello Acme Academy');
    expect(log?.body).toBe('Hi Jamie Rivera, reaching out to Acme Academy.');
    expect(log?.channel).toBe('email');
    expect(log?.templateId).toBe('tpl-1');
    expect(log?.sentAutomatically).toBe(true);
  });

  it('constructs the idempotency key as cadence-<cadenceId>-<leadId>-<stepIndex>', async () => {
    const getCaptured = mockSendApi({ id: 'resend-email-id-2' });
    const lead = makeLead();

    await sendAutomatedEmail(db, lead, makeTemplate(), context({ cadenceId: 'cad-xyz', stepIndex: 2 }));

    const captured = getCaptured();
    // Headers instances lowercase every header name, including on the way
    // out through fetch()'s real request object — matches the actual
    // wire-level header name Resend's API receives.
    expect(captured?.headers['idempotency-key']).toBe(`cadence-cad-xyz-${lead._id}-2`);
  });
});

describe('sendAutomatedEmail — Resend-side rejection is caught, never thrown (issue #150)', () => {
  it('a Resend API error response resolves to sent:false with a "resend rejected" reason, and logs it', async () => {
    mockSendApi({ errorStatus: 422, message: 'recipient is on suppression list' });
    const lead = makeLead();

    const result = await sendAutomatedEmail(db, lead, makeTemplate(), context());

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('resend rejected');
    expect(result.reason).toContain('recipient is on suppression list');

    const log = await latestLog(lead._id);
    expect(log?.routingAllowed).toBe(false);
    expect(log?.routingReason).toContain('resend rejected');
  });

  it('a network-level throw from the Resend client resolves to sent:false rather than throwing', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });
    const lead = makeLead();

    const result = await sendAutomatedEmail(db, lead, makeTemplate(), context());

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('resend rejected');

    const log = await latestLog(lead._id);
    expect(log?.routingAllowed).toBe(false);
  });
});

describe('sendAutomatedEmail — from-address resolution (issue #150, updated #195)', () => {
  // Issue #195 — the per-brand override moved from the RESEND_FROM_<BRAND>
  // env var to the brand's own `fromEmail` field (app/lib/brand.ts's
  // BrandConfig), read from Mongo via getBrandConfig() instead of
  // process.env. Seeded directly into the `brands` collection here, the
  // same way tests/integration/sales-settings.integration.test.ts seeds a
  // legacy doc directly rather than going through an admin API.
  it('uses a brand-specific fromEmail override when the brand record has one set', async () => {
    const now = new Date().toISOString();
    await db.collection('brands').insertOne({
      slug: 'seyu',
      label: 'Seyu',
      dbCollection: 'seyu_leads',
      apiPrefix: '/api/leads',
      currency: 'EUR',
      aliases: ['seyu', 'seyusales'],
      ownNameTerms: ['seyu'],
      forecastModel: 'custom',
      fromEmail: 'Seyu Sales <sales@seyu-verified.example>',
      createdAt: now,
      createdBy: 'test@example.com',
      updatedAt: now,
    });
    const getCaptured = mockSendApi({ id: 'resend-email-id-3' });
    const lead = makeLead();

    await sendAutomatedEmail(db, lead, makeTemplate(), context({ brand: 'seyu' }));

    expect(getCaptured()?.body.from).toBe('Seyu Sales <sales@seyu-verified.example>');
    await db.collection('brands').deleteMany({});
  });
});

function manualContext(overrides: Partial<{ brand: string; tenantId: string; idempotencyKey: string }> = {}) {
  return { brand: 'cogmap', tenantId: 'default', idempotencyKey: 'client-key-1', ...overrides };
}

async function latestActivityLogEntry(leadId: string) {
  return db.collection('activityLog').findOne({ leadId }, { sort: { createdAt: -1 } });
}

// Issue #205 — sendManualEmail(), the new rep-initiated send path, sharing
// dispatchOutreachEmail()'s core with sendAutomatedEmail() above. Every
// scenario the issue's own Acceptance Criteria names is covered here, same
// mocked-fetch convention as the cadence tests above (never a real network
// call — this sandbox has no RESEND_API_KEY configured anyway).
describe('sendManualEmail — successful send writes outreach_logs + activityLog (issue 205)', () => {
  it('writes an outreach_logs row with sendAttempted/resendEmailId/activityLogWritten, and a matching activityLog row', async () => {
    const getCaptured = mockSendApi({ id: 'resend-manual-id-1' });
    const lead = makeLead();

    const result = await sendManualEmail(db, lead, makeTemplate(), manualContext());

    expect(result.sent).toBe(true);
    expect(result.resendEmailId).toBe('resend-manual-id-1');

    const log = await latestLog(lead._id);
    expect(log?.sendAttempted).toBe(true);
    expect(log?.resendEmailId).toBe('resend-manual-id-1');
    expect(log?.sentAutomatically).toBe(false);
    expect(log?.cadenceId).toBeFalsy();
    expect(log?.activityLogWritten).toBe(true);

    const activityEntry = await latestActivityLogEntry(lead._id);
    expect(activityEntry).toBeTruthy();
    expect(activityEntry?.type).toBe('email-outbound');
    expect(activityEntry?.direction).toBe('outbound');
    expect(activityEntry?.source).toBe('manual');
    expect(activityEntry?.externalId).toBe('resend-manual-id-1');

    const captured = getCaptured();
    expect(captured?.body.to).toBe('jamie@acme-academy.com');
  });

  it('constructs the idempotency key as manual-<leadId>-<clientIdempotencyKey>', async () => {
    mockSendApi({ id: 'resend-manual-id-2' });
    const lead = makeLead();
    const getCaptured = mockSendApi({ id: 'resend-manual-id-2' });

    await sendManualEmail(db, lead, makeTemplate(), manualContext({ idempotencyKey: 'client-uuid-xyz' }));

    expect(getCaptured()?.headers['idempotency-key']).toBe(`manual-${lead._id}-client-uuid-xyz`);
  });

  it('a routing-blocked manual send writes outreach_logs (sendAttempted:true) but no activityLog row', async () => {
    mockSendApi({ id: 'should-not-be-called' });
    const lead = makeLead({ contacts: [{ name: 'No Email Guy', isDecisionMaker: true }] });

    const result = await sendManualEmail(db, lead, makeTemplate(), manualContext());

    expect(result.sent).toBe(false);
    const log = await latestLog(lead._id);
    expect(log?.sendAttempted).toBe(true);
    expect(log?.routingAllowed).toBe(false);
    expect(log?.activityLogWritten).toBeFalsy();

    const activityEntry = await latestActivityLogEntry(lead._id);
    expect(activityEntry).toBeNull();
  });

  it('a Resend-side rejection writes outreach_logs but no activityLog row', async () => {
    mockSendApi({ errorStatus: 422, message: 'recipient is on suppression list' });
    const lead = makeLead();

    const result = await sendManualEmail(db, lead, makeTemplate(), manualContext());

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('resend rejected');
    const log = await latestLog(lead._id);
    expect(log?.sendAttempted).toBe(true);
    expect(log?.activityLogWritten).toBeFalsy();
  });

  it('does not double-write activityLog on a retried call with the same resendEmailId', async () => {
    mockSendApi({ id: 'resend-manual-retry-id' });
    const lead = makeLead();

    await sendManualEmail(db, lead, makeTemplate(), manualContext({ idempotencyKey: 'retry-key' }));
    mockSendApi({ id: 'resend-manual-retry-id' }); // Resend itself would dedupe and return the same id again
    await sendManualEmail(db, lead, makeTemplate(), manualContext({ idempotencyKey: 'retry-key' }));

    const count = await db.collection('activityLog').countDocuments({ leadId: lead._id, externalId: 'resend-manual-retry-id' });
    expect(count).toBe(1);
  });
});

// Regression: sendAutomatedEmail()'s cadence-path behavior (idempotency key,
// cadenceId/stepIndex fields, cron call site) must be unchanged by the
// dispatchOutreachEmail() refactor — the describe blocks above this one
// already exercise every cadence scenario unmodified; this adds the one new
// assertion specific to the refactor itself.
describe('sendAutomatedEmail — unaffected by the dispatchOutreachEmail() refactor (issue 205)', () => {
  it('a cadence send never writes activityLogWritten or an activityLog row', async () => {
    mockSendApi({ id: 'resend-cadence-unaffected-id' });
    const lead = makeLead();

    await sendAutomatedEmail(db, lead, makeTemplate(), context());

    const log = await latestLog(lead._id);
    expect(log?.activityLogWritten).toBeFalsy();
    const activityEntry = await latestActivityLogEntry(lead._id);
    expect(activityEntry).toBeNull();
  });
});
