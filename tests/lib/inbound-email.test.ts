import { describe, it, expect } from 'vitest';
import {
  resolveBrandFromAddress, resolveBrandFromRecipients, resolveMatchedAddress,
  resolveDirection, buildActivityLogDoc,
} from '../../app/lib/inbound-email';

describe('resolveBrandFromAddress (issue #141)', () => {
  it('resolves cogmap from a matching local-part prefix', () => {
    expect(resolveBrandFromAddress('cogmap@abc123.resend.app')).toBe('cogmap');
  });

  it('resolves seyu from a matching local-part prefix', () => {
    expect(resolveBrandFromAddress('seyu@abc123.resend.app')).toBe('seyu');
  });

  it('resolves via prefix match, not exact match (e.g. cogmap-log@...)', () => {
    expect(resolveBrandFromAddress('cogmap-log@abc123.resend.app')).toBe('cogmap');
  });

  it('is case-insensitive', () => {
    expect(resolveBrandFromAddress('CogMap@abc123.resend.app')).toBe('cogmap');
  });

  it('returns null for an address matching no known brand', () => {
    expect(resolveBrandFromAddress('unknown@abc123.resend.app')).toBeNull();
  });

  it('returns null for empty/missing input', () => {
    expect(resolveBrandFromAddress('')).toBeNull();
    expect(resolveBrandFromAddress(undefined)).toBeNull();
    expect(resolveBrandFromAddress(null)).toBeNull();
  });
});

describe('resolveBrandFromRecipients (issue #141)', () => {
  it('prefers received_for over to when both are present', () => {
    expect(resolveBrandFromRecipients(['seyu@abc.resend.app'], ['cogmap@abc.resend.app'])).toBe('seyu');
  });

  it('falls back to to[] when received_for resolves nothing', () => {
    expect(resolveBrandFromRecipients(['unknown@abc.resend.app'], ['cogmap@abc.resend.app'])).toBe('cogmap');
  });

  it('returns null when neither resolves', () => {
    expect(resolveBrandFromRecipients(['a@b.com'], ['c@d.com'])).toBeNull();
  });

  it('handles undefined arrays without throwing', () => {
    expect(resolveBrandFromRecipients(undefined, undefined)).toBeNull();
  });
});

describe('resolveMatchedAddress (issue #141)', () => {
  it('returns the specific address that matched, not just the first entry', () => {
    expect(resolveMatchedAddress(['unknown@x.com'], ['cogmap@abc.resend.app', 'someone-else@x.com']))
      .toBe('cogmap@abc.resend.app');
  });

  it('returns null when nothing matches', () => {
    expect(resolveMatchedAddress(['a@b.com'], ['c@d.com'])).toBeNull();
  });
});

describe('resolveDirection (issue #141)', () => {
  const ourAddress = 'cogmap@abc123.resend.app';

  it('classifies as inbound when our address is explicitly in To', () => {
    expect(resolveDirection({ to: [ourAddress], cc: [], ourAddress })).toBe('inbound');
  });

  it('classifies as inbound when our address is explicitly in Cc', () => {
    expect(resolveDirection({ to: ['lead@example.com'], cc: [ourAddress], ourAddress })).toBe('inbound');
  });

  it('classifies as outbound when our address appears in neither To nor Cc (bcc-capture shape)', () => {
    expect(resolveDirection({ to: ['lead@example.com'], cc: [], ourAddress })).toBe('outbound');
  });

  it('is case-insensitive when comparing addresses', () => {
    expect(resolveDirection({ to: ['COGMAP@ABC123.RESEND.APP'], cc: [], ourAddress })).toBe('inbound');
  });
});

describe('buildActivityLogDoc (issue #141)', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('builds an inbound entry when our address is in To (a genuine reply shape)', () => {
    const doc = buildActivityLogDoc({
      emailId: 'email-123',
      from: 'lead-contact@example.com',
      to: ['cogmap@abc123.resend.app'],
      cc: [],
      bcc: [],
      receivedFor: ['cogmap@abc123.resend.app'],
      subject: 'Re: following up',
      messageId: '<111@example.com>',
    }, 'Thanks for reaching out!', now);

    expect(doc.leadId).toBeNull();
    expect(doc.brand).toBe('cogmap');
    expect(doc.type).toBe('email-inbound');
    expect(doc.direction).toBe('inbound');
    expect(doc.fromAddress).toBe('lead-contact@example.com');
    expect(doc.bodyExcerpt).toBe('Thanks for reaching out!');
    expect(doc.source).toBe('inbound-webhook');
    expect(doc.externalId).toBe('email-123');
    expect(doc.matchedContactKey).toBeNull();
    expect(doc.createdAt).toBe(now);
  });

  it('builds an outbound entry when our address is only reachable via received_for (a bcc-capture shape)', () => {
    const doc = buildActivityLogDoc({
      emailId: 'email-456',
      from: 'rep@ourcompany.com',
      to: ['lead-contact@example.com'],
      cc: [],
      bcc: [],
      receivedFor: ['seyu@abc123.resend.app'],
      subject: 'Quick intro',
      messageId: '<222@example.com>',
    }, undefined, now);

    expect(doc.brand).toBe('seyu');
    expect(doc.type).toBe('email-outbound');
    expect(doc.direction).toBe('outbound');
  });

  it('marks brand as "unresolved" (not dropped) when no address matches a known brand', () => {
    const doc = buildActivityLogDoc({
      emailId: 'email-789',
      from: 'someone@example.com',
      to: ['unknown@abc123.resend.app'],
      cc: [],
      bcc: [],
      receivedFor: ['unknown@abc123.resend.app'],
      subject: 'Test',
      messageId: '<333@example.com>',
    }, undefined, now);

    expect(doc.brand).toBe('unresolved');
  });

  it('always defaults tenantId to default (no per-tenant inbound routing yet)', () => {
    const doc = buildActivityLogDoc({
      emailId: 'email-999', from: 'a@b.com', to: ['cogmap@abc.resend.app'], cc: [], bcc: [],
      receivedFor: ['cogmap@abc.resend.app'], subject: '', messageId: '',
    }, undefined, now);
    expect(doc.tenantId).toBe('default');
  });
});
