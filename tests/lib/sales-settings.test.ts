import { describe, it, expect } from 'vitest';
import { sanitizeSalesSettings, emptySalesSettings, emptyProductLine } from '../../app/lib/sales-settings';

describe('emptySalesSettings', () => {
  it('fills brand and tenantId with safe empty defaults', () => {
    const settings = emptySalesSettings('cogmap', 'acme');
    expect(settings.brand).toBe('cogmap');
    expect(settings.tenantId).toBe('acme');
    expect(settings.products).toEqual([]);
    expect(settings.customerTypes).toEqual([]);
  });

  it('defaults tenantId to "default" when omitted', () => {
    const settings = emptySalesSettings('seyu');
    expect(settings.tenantId).toBe('default');
  });

  it('defaults revenueTarget currency to match the brand\'s own forecast currency, amount unset', () => {
    expect(emptySalesSettings('cogmap').revenueTarget).toEqual({ currency: 'USD', period: 'annual' });
    expect(emptySalesSettings('seyu').revenueTarget).toEqual({ currency: 'EUR', period: 'annual' });
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
    const result = sanitizeSalesSettings({ brand: 'seyu', tenantId: 'other' }, 'cogmap', 'default');
    expect(result.brand).toBe('cogmap');
    expect(result.tenantId).toBe('default');
  });

  it('returns safe defaults for a non-object body', () => {
    const result = sanitizeSalesSettings(null, 'cogmap', 'default');
    expect(result.companyName).toBe('');
    expect(result.products).toEqual([]);
    expect(result.dealSize).toEqual({ small: undefined, medium: undefined, large: undefined, enterprise: undefined, largestWon: undefined });
  });

  it('trims strings and enforces max lengths', () => {
    const result = sanitizeSalesSettings({ companyName: '  Acme FC  ' }, 'cogmap', 'default');
    expect(result.companyName).toBe('Acme FC');
  });

  it('drops unknown enum values and keeps known ones', () => {
    const result = sanitizeSalesSettings({ customerTypes: ['schools', 'not_a_real_type', 'sponsors'] }, 'cogmap', 'default');
    expect(result.customerTypes).toEqual(['schools', 'sponsors']);
  });

  it('deduplicates enum array values', () => {
    const result = sanitizeSalesSettings({ purchaseFrequency: ['monthly', 'monthly', 'yearly'] }, 'cogmap', 'default');
    expect(result.purchaseFrequency).toEqual(['monthly', 'yearly']);
  });

  it('coerces numeric-string prices to numbers instead of silently corrupting them', () => {
    const result = sanitizeSalesSettings({ dealSize: { small: '1500', medium: 3000 } }, 'cogmap', 'default');
    expect(result.dealSize.small).toBe(1500);
    expect(result.dealSize.medium).toBe(3000);
  });

  it('drops negative and non-numeric price values to undefined/zero-floored', () => {
    const result = sanitizeSalesSettings({ dealSize: { small: -50, medium: 'not-a-number' } }, 'cogmap', 'default');
    expect(result.dealSize.small).toBe(0);
    expect(result.dealSize.medium).toBeUndefined();
  });

  it('defaults regionMultipliers to an empty object (issue #84)', () => {
    const result = sanitizeSalesSettings(null, 'cogmap', 'default');
    expect(result.regionMultipliers).toEqual({});
  });

  it('uppercases region keys and coerces numeric-string multipliers', () => {
    const result = sanitizeSalesSettings({ regionMultipliers: { cee: '0.8', MENA: 1.2 } }, 'cogmap', 'default');
    expect(result.regionMultipliers).toEqual({ CEE: 0.8, MENA: 1.2 });
  });

  it('drops region multiplier entries that are zero, negative, or non-numeric rather than storing a corrupted value', () => {
    const result = sanitizeSalesSettings({ regionMultipliers: { US: 0, CEE: -1, MENA: 'nonsense', NA: 1.5 } }, 'cogmap', 'default');
    expect(result.regionMultipliers).toEqual({ NA: 1.5 });
  });

  it('drops region keys that sanitize to empty and caps the total entry count', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 60; i++) many[`R${i}`] = 1.1;
    const result = sanitizeSalesSettings({ regionMultipliers: { '': 2, '   ': 3, ...many } }, 'cogmap', 'default');
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
    }, 'cogmap', 'default');

    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Cognitive Assessment');
    expect(result.products[0].pricingModels).toEqual(['per_user']);
    expect(result.products[0].pricing.perUserPrice).toBe(25);
    expect(result.products[0].pricing.perUserMinimum).toBe(10);
    expect(result.products[0].typicalBuyer).toEqual(['coach', 'other']);
    expect(result.products[0].revenuePredictability).toBe('very_predictable');
  });

  it('assigns a fallback id to a product line missing one', () => {
    const result = sanitizeSalesSettings({ products: [{ name: 'X' }] }, 'cogmap', 'default');
    expect(result.products[0].id).toBe('product-0');
  });

  it('rejects an invalid enum value for a single-select field', () => {
    const result = sanitizeSalesSettings({ salesCycle: 'not_a_real_option' }, 'cogmap', 'default');
    expect(result.salesCycle).toBe('');
  });

  it('sanitizes nested exampleCustomer and seasonality objects', () => {
    const result = sanitizeSalesSettings({
      exampleCustomer: { name: 'Test FC', totalContractValue: '4200' },
      seasonality: { quarters: ['Q1', 'Q3', 'invalid'], specificMonths: 'August' },
    }, 'cogmap', 'default');

    expect(result.exampleCustomer.name).toBe('Test FC');
    expect(result.exampleCustomer.totalContractValue).toBe(4200);
    expect(result.seasonality.quarters).toEqual(['Q1', 'Q3']);
    expect(result.seasonality.specificMonths).toBe('August');
  });

  it('sanitizes revenueTarget, coercing a numeric-string amount and validating currency/period', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: '500000', currency: 'EUR', period: 'quarterly' },
    }, 'cogmap', 'default');
    expect(result.revenueTarget).toEqual({ amount: 500000, currency: 'EUR', period: 'quarterly' });
  });

  it('falls back to the brand default currency and annual period for an invalid revenueTarget', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: 100000, currency: 'GBP', period: 'weekly' },
    }, 'seyu', 'default');
    expect(result.revenueTarget).toEqual({ amount: 100000, currency: 'EUR', period: 'annual' });
  });

  it('clamps a negative revenueTarget amount to 0 rather than rejecting the whole object', () => {
    const result = sanitizeSalesSettings({
      revenueTarget: { amount: -1000, currency: 'USD', period: 'monthly' },
    }, 'cogmap', 'default');
    expect(result.revenueTarget.amount).toBe(0);
  });

  it('defaults revenueTarget when entirely absent from the body', () => {
    const result = sanitizeSalesSettings({}, 'cogmap', 'default');
    expect(result.revenueTarget).toEqual({ currency: 'USD', period: 'annual' });
  });
});
