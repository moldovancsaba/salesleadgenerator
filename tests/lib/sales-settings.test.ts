import { describe, it, expect } from 'vitest';
import {
  sanitizeSalesSettings, emptySalesSettings, emptyProductLine, defaultRevenueTargetCurrency,
  getAllowedCustomerTypes, getAllowedBuyerRoles, getCustomerTypeOptions, getBuyerRoleOptions,
} from '../../app/lib/sales-settings';

// Issue #195 — these functions no longer look a brand up themselves (a
// Client Component that renders Sales Settings can't call the Mongo-backed
// getBrandConfig() the way an async route/page can); the caller resolves
// the brand's own `salesVocabulary` (app/lib/brand.ts's BrandConfig field,
// itself the direct replacement for the old static BRAND_SALES_VOCABULARY
// map) and passes it in directly. These literals mirror
// FALLBACK_BRAND_CONFIG's real fixture values.
const COGMAP_VOCAB = { customerTypes: ['sports_clubs', 'federations', 'schools', 'academies', 'event_organisers'], buyerRoles: ['coach', 'federation', 'club', 'parent', 'athlete'] };
const SEYU_VOCAB = { customerTypes: ['sports_clubs', 'federations', 'schools', 'academies', 'event_organisers'], buyerRoles: [] };
const DVSC_VOCAB = { customerTypes: [], buyerRoles: [] };

// Issue #146 — CustomerType/BuyerRole are now brand-scoped: a universal base
// set plus each brand's own extension, replacing one universal list applied
// identically to every brand. Confirmed real mismatch this fixes: BuyerRole's
// 'coach'/'athlete'/'federation'/'club'/'parent' fit CogMap's own product but
// have no place in Seyu's real business (fan engagement services).
describe('brand-scoped CustomerType/BuyerRole', () => {
  it("CogMap's buyer-role options are unchanged from the full pre-refactor list", () => {
    const values = getBuyerRoleOptions(COGMAP_VOCAB).map((o) => o.value);
    expect(values).toEqual(['ceo', 'marketing', 'commercial', 'coach', 'federation', 'club', 'brand', 'parent', 'athlete', 'other']);
  });

  it("Seyu's buyer-role options no longer include coach/athlete/federation/club/parent", () => {
    const values = getBuyerRoleOptions(SEYU_VOCAB).map((o) => o.value);
    expect(values).toEqual(['ceo', 'marketing', 'commercial', 'brand', 'other']);
    expect(values).not.toContain('coach');
    expect(values).not.toContain('athlete');
  });

  it("CogMap's customer-type options are unchanged from the full pre-refactor list", () => {
    const values = getCustomerTypeOptions(COGMAP_VOCAB).map((o) => o.value);
    expect(values).toEqual(['sports_clubs', 'federations', 'schools', 'academies', 'event_organisers', 'sponsors', 'brands', 'government', 'other']);
  });

  it('an unspecified/omitted vocabulary falls back to the universal base set only', () => {
    expect(getAllowedBuyerRoles(undefined)).toEqual(['ceo', 'marketing', 'commercial', 'brand', 'other']);
    expect(getAllowedCustomerTypes(undefined)).toEqual(['sponsors', 'brands', 'government', 'other']);
  });

  // Issue #148 — DVSC's confirmed vocabulary decision: its real customers
  // (sponsor companies) and buyer personas are already fully covered by the
  // universal base set, so its own explicit salesVocabulary has empty
  // extensions (not the sport-specific values CogMap/Seyu use, which
  // describe who *they* sell to, not who buys sponsorship from DVSC).
  it("DVSC's options are exactly the universal base set — no sport-specific extension", () => {
    expect(getBuyerRoleOptions(DVSC_VOCAB).map((o) => o.value)).toEqual(['ceo', 'marketing', 'commercial', 'brand', 'other']);
    expect(getCustomerTypeOptions(DVSC_VOCAB).map((o) => o.value)).toEqual(['sponsors', 'brands', 'government', 'other']);
  });
});

describe('sanitizeSalesSettings — brand-scoped vocabulary validation', () => {
  it('drops a CogMap-only buyer role from a product saved under Seyu, not silently stores it', () => {
    const result = sanitizeSalesSettings({
      products: [{ name: 'Fan App', typicalBuyer: ['coach', 'marketing', 'athlete'] }],
    }, 'seyu', 'default', 'EUR', SEYU_VOCAB);
    expect(result.products[0].typicalBuyer).toEqual(['marketing']);
  });

  it('keeps a CogMap-only buyer role when saved under CogMap (no behavior change)', () => {
    const result = sanitizeSalesSettings({
      products: [{ name: 'Assessment', typicalBuyer: ['coach', 'athlete'] }],
    }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.products[0].typicalBuyer).toEqual(['coach', 'athlete']);
  });

  // GET /api/sales-settings/[brand] runs every stored document through this
  // same sanitizer before returning it to the client (issue #101's GET/PUT
  // consistency guarantee) — so a Seyu document saved before this brand-
  // scoping existed, still holding a now-out-of-scope value like 'coach',
  // must never throw when re-sanitized on its next read. sanitizeEnumArray's
  // existing drop-not-throw contract already covers this; this test proves
  // it still holds now that the allowed set is brand-scoped, not global.
  it('never throws re-sanitizing a stale document with a now-out-of-scope value (GET-path safety)', () => {
    expect(() => sanitizeSalesSettings({
      customerTypes: ['schools', 'sponsors'],
      products: [{ name: 'Legacy', typicalBuyer: ['coach'] }],
    }, 'seyu', 'default', 'EUR', SEYU_VOCAB)).not.toThrow();
  });
});

// Issue #145 — defaultRevenueTargetCurrency() used to look the brand's
// currency up itself (via BRAND_CONFIG[brand].currency); issue #195 moved
// that lookup to the caller (a Client Component can't call the Mongo-backed
// getBrandConfig() the way an async route/page can) — this function now
// just applies the USD fallback to an already-resolved currency.
describe('defaultRevenueTargetCurrency', () => {
  it('returns whatever currency is passed in, unchanged', () => {
    expect(defaultRevenueTargetCurrency('USD')).toBe('USD');
    expect(defaultRevenueTargetCurrency('EUR')).toBe('EUR');
  });

  it('falls back to USD when no currency is known yet, instead of throwing', () => {
    expect(defaultRevenueTargetCurrency(undefined)).toBe('USD');
  });
});

describe('emptySalesSettings', () => {
  it('fills brand and tenantId with safe empty defaults', () => {
    const settings = emptySalesSettings('cogmap', 'acme', 'USD');
    expect(settings.brand).toBe('cogmap');
    expect(settings.tenantId).toBe('acme');
    expect(settings.products).toEqual([]);
    expect(settings.customerTypes).toEqual([]);
  });

  it('defaults tenantId to "default" when omitted', () => {
    const settings = emptySalesSettings('seyu', undefined, 'EUR');
    expect(settings.tenantId).toBe('default');
  });

  it('defaults revenueTarget currency to whatever currency the caller resolved, amount unset', () => {
    expect(emptySalesSettings('cogmap', 'default', 'USD').revenueTarget).toEqual({ currency: 'USD', period: 'annual' });
    expect(emptySalesSettings('seyu', 'default', 'EUR').revenueTarget).toEqual({ currency: 'EUR', period: 'annual' });
  });

  it('falls back to USD when no currency is passed at all', () => {
    expect(emptySalesSettings('cogmap').revenueTarget).toEqual({ currency: 'USD', period: 'annual' });
  });

  // Issue #148 — DVSC's real, sane, DVSC-appropriate default (correct EUR
  // currency from #145, correct empty-extension vocabulary from #146/#148),
  // not a generic CogMap-shaped default for a brand-new client with no data yet.
  it('produces a DVSC-appropriate default: EUR currency, empty starting vocabulary', () => {
    const settings = emptySalesSettings('dvsc', 'default', 'EUR');
    expect(settings.brand).toBe('dvsc');
    expect(settings.revenueTarget).toEqual({ currency: 'EUR', period: 'annual' });
    expect(settings.customerTypes).toEqual([]);
    expect(settings.products).toEqual([]);
  });
});

describe('emptyProductLine', () => {
  it('returns a product line with the given id and empty fields', () => {
    const line = emptyProductLine('product-0');
    expect(line.id).toBe('product-0');
    expect(line.name).toBe('');
    expect(line.pricingModels).toEqual([]);
    expect(line.pricing).toEqual({});
  });
});

describe('sanitizeSalesSettings', () => {
  it('always takes brand/tenantId from function params, never from the body', () => {
    const result = sanitizeSalesSettings({ brand: 'seyu', tenantId: 'other' }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.brand).toBe('cogmap');
    expect(result.tenantId).toBe('default');
  });

  it('returns safe defaults for a non-object body', () => {
    const result = sanitizeSalesSettings(null, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.companyName).toBe('');
    expect(result.products).toEqual([]);
    expect(result.dealSize).toEqual({ small: undefined, medium: undefined, large: undefined, enterprise: undefined, largestWon: undefined });
  });

  it('trims strings and enforces max lengths', () => {
    const result = sanitizeSalesSettings({ companyName: '  Acme FC  ' }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.companyName).toBe('Acme FC');
  });

  it('drops unknown enum values and keeps known ones', () => {
    const result = sanitizeSalesSettings({ customerTypes: ['schools', 'not_a_real_type', 'sponsors'] }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.customerTypes).toEqual(['schools', 'sponsors']);
  });

  it('deduplicates enum array values', () => {
    const result = sanitizeSalesSettings({ purchaseFrequency: ['monthly', 'monthly', 'yearly'] }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.purchaseFrequency).toEqual(['monthly', 'yearly']);
  });

  it('coerces numeric-string prices to numbers instead of silently corrupting them', () => {
    const result = sanitizeSalesSettings({ dealSize: { small: '1500', medium: 3000 } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.dealSize.small).toBe(1500);
    expect(result.dealSize.medium).toBe(3000);
  });

  it('drops negative and non-numeric price values to undefined/zero-floored', () => {
    const result = sanitizeSalesSettings({ dealSize: { small: -50, medium: 'not-a-number' } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.dealSize.small).toBe(0);
    expect(result.dealSize.medium).toBeUndefined();
  });

  it('clamps a fat-fingered dealSize value to an upper bound instead of saving it unbounded (issue #94)', () => {
    const result = sanitizeSalesSettings({ dealSize: { enterprise: 8_000_000_000, largestWon: 9_999_999_999 } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.dealSize.enterprise).toBe(50_000_000);
    expect(result.dealSize.largestWon).toBe(50_000_000);
  });

  it('defaults regionMultipliers to an empty object (issue #84)', () => {
    const result = sanitizeSalesSettings(null, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.regionMultipliers).toEqual({});
  });

  it('uppercases region keys and coerces numeric-string multipliers', () => {
    const result = sanitizeSalesSettings({ regionMultipliers: { cee: '0.8', MENA: 1.2 } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.regionMultipliers).toEqual({ CEE: 0.8, MENA: 1.2 });
  });

  it('drops region multiplier entries that are zero, negative, or non-numeric rather than storing a corrupted value', () => {
    const result = sanitizeSalesSettings({ regionMultipliers: { US: 0, CEE: -1, MENA: 'nonsense', NA: 1.5 } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.regionMultipliers).toEqual({ NA: 1.5 });
  });

  it('drops region keys that sanitize to empty and caps the total entry count', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 60; i++) many[`R${i}`] = 1.1;
    const result = sanitizeSalesSettings({ regionMultipliers: { '': 2, '   ': 3, ...many } }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(Object.keys(result.regionMultipliers).length).toBeLessThanOrEqual(50);
  });

  it('sanitizes an array of product lines including nested pricing', () => {
    const result = sanitizeSalesSettings({
      products: [
        {
          name: 'Cognitive Assessment',
          pricingModels: ['per_user', 'bogus_model'],
          pricing: { perUserPrice: '25', perUserMinimum: 10 },
          typicalBuyer: ['coach', 'other'],
          revenuePredictability: 'very_predictable',
        },
      ],
    }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);

    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Cognitive Assessment');
    expect(result.products[0].pricingModels).toEqual(['per_user']);
    expect(result.products[0].pricing.perUserPrice).toBe(25);
    expect(result.products[0].pricing.perUserMinimum).toBe(10);
    expect(result.products[0].typicalBuyer).toEqual(['coach', 'other']);
    expect(result.products[0].revenuePredictability).toBe('very_predictable');
  });

  it('assigns a fallback id to a product line missing one', () => {
    const result = sanitizeSalesSettings({ products: [{ name: 'X' }] }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.products[0].id).toBe('product-0');
  });

  it('rejects an invalid enum value for a single-select field', () => {
    const result = sanitizeSalesSettings({ salesCycle: 'not_a_real_option' }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.salesCycle).toBe('');
  });

  it('sanitizes nested exampleCustomer and seasonality objects', () => {
    const result = sanitizeSalesSettings({
      exampleCustomer: { name: 'Test FC', totalContractValue: '4200' },
      seasonality: { quarters: ['Q1', 'Q3', 'invalid'], specificMonths: 'August' },
    }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);

    expect(result.exampleCustomer.name).toBe('Test FC');
    expect(result.exampleCustomer.totalContractValue).toBe(4200);
    expect(result.seasonality.quarters).toEqual(['Q1', 'Q3']);
    expect(result.seasonality.specificMonths).toBe('August');
  });

  it('sanitizes revenueTarget, coercing a numeric-string amount and validating currency/period', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: '500000', currency: 'EUR', period: 'quarterly' },
    }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.revenueTarget).toEqual({ amount: 500000, currency: 'EUR', period: 'quarterly' });
  });

  it('falls back to the brand default currency and annual period for an invalid revenueTarget', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: 100000, currency: 'GBP', period: 'weekly' },
    }, 'seyu', 'default', 'EUR', SEYU_VOCAB);
    expect(result.revenueTarget).toEqual({ amount: 100000, currency: 'EUR', period: 'annual' });
  });

  it('clamps a negative revenueTarget amount to 0 rather than rejecting the whole object', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: -1000, currency: 'USD', period: 'monthly' },
    }, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.revenueTarget.amount).toBe(0);
  });

  it('defaults revenueTarget when entirely absent from the body', () => {
    const result = sanitizeSalesSettings({}, 'cogmap', 'default', 'USD', COGMAP_VOCAB);
    expect(result.revenueTarget).toEqual({ currency: 'USD', period: 'annual' });
  });
});
