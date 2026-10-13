import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isResendSendConfigured, resolveOutboundFromAddress } from '../../lib/outreach-send';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('isResendSendConfigured (issue 150)', () => {
  it('is false when RESEND_API_KEY is unset', () => {
    delete process.env.RESEND_API_KEY;
    expect(isResendSendConfigured()).toBe(false);
  });

  it('is true when RESEND_API_KEY is set, regardless of RESEND_WEBHOOK_SECRET', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(isResendSendConfigured()).toBe(true);
  });
});

// Issue #195 — the per-brand override used to be the RESEND_FROM_<BRAND> env
// var, read internally from process.env; it's now the brand's own
// `fromEmail` field (app/lib/brand.ts's BrandConfig), passed in explicitly
// by the caller (lib/outreach-send.ts's sendAutomatedEmail, which resolves
// it via getBrandConfig() — see tests/integration for that live-DB path).
// This function itself is now a pure formatter: given brand + optional
// fromEmail, no env/DB access at all beyond the domain-default fallback.
describe('resolveOutboundFromAddress (issue 150, updated 195)', () => {
  beforeEach(() => {
    delete process.env.RESEND_OUTBOUND_DOMAIN;
  });

  it('defaults to <brand>@haho.ai with no fromEmail override and no domain configured', () => {
    expect(resolveOutboundFromAddress('cogmap')).toBe('cogmap@haho.ai');
    expect(resolveOutboundFromAddress('seyu')).toBe('seyu@haho.ai');
  });

  it('respects RESEND_OUTBOUND_DOMAIN for the default (no fromEmail override)', () => {
    process.env.RESEND_OUTBOUND_DOMAIN = 'example.com';
    expect(resolveOutboundFromAddress('dvsc')).toBe('dvsc@example.com');
  });

  it('a brand-specific fromEmail override takes precedence over the domain default', () => {
    process.env.RESEND_OUTBOUND_DOMAIN = 'example.com';
    expect(resolveOutboundFromAddress('cogmap', 'Sales <sales@verified-domain.com>')).toBe('Sales <sales@verified-domain.com>');
    // A brand with no override still falls through to the domain default.
    expect(resolveOutboundFromAddress('seyu')).toBe('seyu@example.com');
  });

  it('an empty-string fromEmail is treated as no override, not a literal empty address', () => {
    expect(resolveOutboundFromAddress('cogmap', '')).toBe('cogmap@haho.ai');
  });
});

describe('dispatchOutreachEmail — Personalization Gating & Send Invariants (issue 241)', () => {
  function createMockDb() {
    const insertedLogs: any[] = [];
    return {
      insertedLogs,
      collection: (name: string) => ({
        insertOne: async (doc: any) => {
          insertedLogs.push({ ...doc, _id: `mock-id-${insertedLogs.length + 1}` });
          return { insertedId: `mock-id-${insertedLogs.length}` };
        },
        findOne: async () => null,
        createIndex: async () => 'idx',
      }),
    };
  }

  it('blocks send with PERSONALIZATION_BLOCKED when required fields are missing', async () => {
    const { dispatchOutreachEmail } = await import('../../lib/outreach-send');
    const mockDb = createMockDb();

    const lead = {
      _id: 'lead-1',
      entity_name: 'Acme Academy',
      contacts: [{ name: '', email: 'contact@acme.org', isDecisionMaker: true }],
    };

    const template = {
      id: 'tpl-strict',
      name: 'Strict Template',
      channel: 'email' as const,
      industry: '',
      subject: 'Hello {first_name}',
      body: 'Hi {first_name}, how is {company_name}?',
      variables: ['first_name', 'company_name'],
      required_fields: ['first_name'],
    };

    const res = await dispatchOutreachEmail(
      mockDb as any,
      lead as any,
      template,
      { brand: 'cogmap', tenantId: 'default' },
      { kind: 'cadence', cadenceId: 'c1', stepIndex: 0 }
    );

    expect(res.sent).toBe(false);
    expect(res.reason).toContain('PERSONALIZATION_BLOCKED: missing required field(s): first_name');
    expect(mockDb.insertedLogs.length).toBe(1);
    expect(mockDb.insertedLogs[0].sendAttempted).toBe(false);
    expect(mockDb.insertedLogs[0].routingAllowed).toBe(false);
  });

  it('only dispatches to primary email and rejects secondaryEmail as destination', async () => {
    const { dispatchOutreachEmail } = await import('../../lib/outreach-send');
    const mockDb = createMockDb();

    const lead = {
      _id: 'lead-2',
      entity_name: 'Tech Prep',
      contacts: [
        {
          name: 'Ada Lovelace',
          // Primary email missing
          email: '',
          secondaryEmail: 'ada.backup@gmail.com',
          isDecisionMaker: true,
        },
      ],
    };

    const template = {
      id: 'tpl-general',
      name: 'General Intro',
      channel: 'email' as const,
      industry: '',
      subject: 'Hello',
      body: 'Hi there',
      variables: [],
    };

    const res = await dispatchOutreachEmail(
      mockDb as any,
      lead as any,
      template,
      { brand: 'cogmap', tenantId: 'default' },
      { kind: 'manual', idempotencyKey: 'idem-1' }
    );

    expect(res.sent).toBe(false);
    expect(res.reason).toBe('Missing decision maker email for email outreach.');
    expect(mockDb.insertedLogs.length).toBe(1);
    expect(mockDb.insertedLogs[0].sendAttempted).toBe(true);
    expect(mockDb.insertedLogs[0].routingAllowed).toBe(false);
  });

  it('blocks send with ATTACHMENT_MISSING when referenced documents are missing from library (issue 243)', async () => {
    const { dispatchOutreachEmail } = await import('../../lib/outreach-send');
    const insertedLogs: any[] = [];
    const mockDb = {
      insertedLogs,
      collection: (name: string) => {
        if (name === 'documents') {
          return {
            find: () => ({
              toArray: async () => [],
            }),
          };
        }
        return {
          insertOne: async (doc: any) => {
            insertedLogs.push({ ...doc, _id: `mock-id-${insertedLogs.length + 1}` });
            return { insertedId: `mock-id-${insertedLogs.length}` };
          },
          findOne: async () => null,
          createIndex: async () => 'idx',
        };
      },
    };

    const lead = {
      _id: 'lead-3',
      entity_name: 'Acme Media',
      contacts: [{ name: 'John Doe', email: 'john@acme.org', isDecisionMaker: true }],
    };

    const template = {
      id: 'tpl-deck',
      name: 'Pitch Deck Template',
      channel: 'email' as const,
      industry: '',
      subject: 'Overview Deck',
      body: 'Hi {first_name}, attached is our deck.',
      variables: ['first_name'],
      documentIds: ['doc-missing-123'],
    };

    const res = await dispatchOutreachEmail(
      mockDb as any,
      lead as any,
      template,
      { brand: 'cogmap', tenantId: 'default' },
      { kind: 'cadence', cadenceId: 'c1', stepIndex: 0 }
    );

    expect(res.sent).toBe(false);
    expect(res.reason).toContain('ATTACHMENT_MISSING: missing attachment(s): document_id_doc-missing-123');
    expect(mockDb.insertedLogs.length).toBe(1);
    expect(mockDb.insertedLogs[0].sendAttempted).toBe(false);
    expect(mockDb.insertedLogs[0].routingAllowed).toBe(false);
  });
});

