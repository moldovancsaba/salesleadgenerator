import { describe, it, expect } from 'vitest';
import { BRAND_CONFIG, CURRENCY_CODES, CURRENCY_CODE_OPTIONS, resolveBrand } from '../../app/lib/brand';

// Issue #145 — app/lib/brand.ts's BRAND_CONFIG is now the single source of
// truth for brand->currency, replacing the 3 independently-hardcoded
// 'USD' | 'EUR' unions and ternaries this issue removed
// (lib/ticket-size.ts's TicketSizeCurrency, app/lib/sales-settings.ts's
// RevenueTargetCurrency + defaultRevenueTargetCurrency ternary, app/lib/
// forecast.ts's FORECAST_CURRENCY map).
describe('BRAND_CONFIG currency', () => {
  it('reports CogMap in USD and Seyu in EUR — zero behavior change for existing brands', () => {
    expect(BRAND_CONFIG.cogmap.currency).toBe('USD');
    expect(BRAND_CONFIG.seyu.currency).toBe('EUR');
  });

  it('reports DVSC in EUR (issue #147)', () => {
    expect(BRAND_CONFIG.dvsc.currency).toBe('EUR');
  });

  it('every BRAND_CONFIG entry has a currency drawn from CURRENCY_CODES', () => {
    for (const config of Object.values(BRAND_CONFIG)) {
      expect(CURRENCY_CODES).toContain(config.currency);
    }
  });
});

describe('CURRENCY_CODE_OPTIONS / CURRENCY_CODES', () => {
  it('CURRENCY_CODES is derived from CURRENCY_CODE_OPTIONS, not a separate hand-maintained list', () => {
    expect(CURRENCY_CODES).toEqual(CURRENCY_CODE_OPTIONS.map((o) => o.value));
  });

  it('includes both currencies this app currently uses', () => {
    expect(CURRENCY_CODES).toEqual(expect.arrayContaining(['USD', 'EUR']));
  });
});

// Issue #147 — resolveBrand()'s single highest-priority fix: a genuinely
// unrecognized, non-empty brand value previously silently resolved to
// 'cogmap' (a real, silent wrong-brand-read/write risk). It now returns
// null, distinct from the legitimate "no brand specified at all" default.
describe('resolveBrand', () => {
  it('resolves all 3 known brand keys and their *sales aliases', () => {
    expect(resolveBrand('cogmap')).toBe('cogmap');
    expect(resolveBrand('cogmapsales')).toBe('cogmap');
    expect(resolveBrand('seyu')).toBe('seyu');
    expect(resolveBrand('seyusales')).toBe('seyu');
    expect(resolveBrand('dvsc')).toBe('dvsc');
    expect(resolveBrand('dvscsales')).toBe('dvsc');
  });

  it('is case-insensitive', () => {
    expect(resolveBrand('DVSC')).toBe('dvsc');
    expect(resolveBrand('CogMap')).toBe('cogmap');
  });

  it('still defaults to cogmap for a genuinely empty/absent value (distinct from an invalid one)', () => {
    expect(resolveBrand(undefined)).toBe('cogmap');
    expect(resolveBrand(null)).toBe('cogmap');
    expect(resolveBrand('')).toBe('cogmap');
  });

  it('returns null — never a silently guessed brand — for a genuinely unrecognized, non-empty value', () => {
    expect(resolveBrand('not_a_real_brand')).toBeNull();
    expect(resolveBrand('cogmap; DROP TABLE leads')).toBeNull();
    expect(resolveBrand('seyuu')).toBeNull();
  });
});
