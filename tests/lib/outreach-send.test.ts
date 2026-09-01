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

// Issue #195 — the per-brand override used to be the RESEND_FROM_<BRAND> env
// var, read internally from process.env; it's now the brand's own
// `fromEmail` field (app/lib/brand.ts's BrandConfig), passed in explicitly
// by the caller (lib/outreach-send.ts's sendAutomatedEmail, which resolves
// it via getBrandConfig() — see tests/integration for that live-DB path).
// This function itself is now a pure formatter: given brand + optional
// fromEmail, no env/DB access at all beyond the domain-default fallback.
describe('resolveOutboundFromAddress (issue #150, updated #195)', () => {
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
