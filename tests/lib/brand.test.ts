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

describe('resolveBrand', () => {
  it('resolves known brand keys and their *sales aliases', () => {
    expect(resolveBrand('cogmap')).toBe('cogmap');
    expect(resolveBrand('cogmapsales')).toBe('cogmap');
    expect(resolveBrand('seyu')).toBe('seyu');
    expect(resolveBrand('seyusales')).toBe('seyu');
  });

  it('falls back to cogmap for an unrecognized value', () => {
    expect(resolveBrand('not_a_real_brand')).toBe('cogmap');
    expect(resolveBrand(undefined)).toBe('cogmap');
    expect(resolveBrand(null)).toBe('cogmap');
  });
});
