import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { sendAutomatedEmail, type LeadForSend } from '../../lib/outreach-send';
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

beforeAll(async () => {
  mongod = await startTestMongo();
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  db = client.db();
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

describe('sendAutomatedEmail — from-address resolution (issue #150)', () => {
  it('uses a brand-specific RESEND_FROM_<BRAND> override when set', async () => {
    process.env.RESEND_FROM_SEYU = 'Seyu Sales <sales@seyu-verified.example>';
    const getCaptured = mockSendApi({ id: 'resend-email-id-3' });
    const lead = makeLead();

    await sendAutomatedEmail(db, lead, makeTemplate(), context({ brand: 'seyu' }));

    expect(getCaptured()?.body.from).toBe('Seyu Sales <sales@seyu-verified.example>');
    delete process.env.RESEND_FROM_SEYU;
  });
});
