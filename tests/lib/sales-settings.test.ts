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
    expect(result.dealSize).toEqual({ small: undefined, medium: undefined, large: undefined, largestWon: undefined });
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
});
