import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isResendSendConfigured, resolveOutboundFromAddress } from '../../lib/outreach-send';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('isResendSendConfigured (issue #150)', () => {
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

describe('resolveOutboundFromAddress (issue #150)', () => {
  beforeEach(() => {
    delete process.env.RESEND_OUTBOUND_DOMAIN;
    delete process.env.RESEND_FROM_COGMAP;
    delete process.env.RESEND_FROM_SEYU;
  });

  it('defaults to <brand>@haho.ai with no env configuration', () => {
    expect(resolveOutboundFromAddress('cogmap')).toBe('cogmap@haho.ai');
    expect(resolveOutboundFromAddress('seyu')).toBe('seyu@haho.ai');
  });

  it('respects RESEND_OUTBOUND_DOMAIN', () => {
    process.env.RESEND_OUTBOUND_DOMAIN = 'example.com';
    expect(resolveOutboundFromAddress('dvsc')).toBe('dvsc@example.com');
  });

  it('a brand-specific RESEND_FROM_<BRAND> override takes precedence over the domain default', () => {
    process.env.RESEND_OUTBOUND_DOMAIN = 'example.com';
    process.env.RESEND_FROM_COGMAP = 'Sales <sales@verified-domain.com>';
    expect(resolveOutboundFromAddress('cogmap')).toBe('Sales <sales@verified-domain.com>');
    // A brand with no override still falls through to the domain default.
    expect(resolveOutboundFromAddress('seyu')).toBe('seyu@example.com');
  });

  it('is case-insensitive on the brand key when looking up the override', () => {
    process.env.RESEND_FROM_COGMAP = 'override@example.com';
    expect(resolveOutboundFromAddress('cogmap')).toBe('override@example.com');
  });
});
