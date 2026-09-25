import { describe, it, expect } from 'vitest';
import { sanitizeProduct, sanitizeProducts, isValidPricingModel, resolveProductLinePrice, PRODUCT_ABSOLUTE_CEILING } from '../../app/lib/products';

const NOW = new Date('2026-09-25T00:00:00.000Z');

describe('isValidPricingModel', () => {
  it('accepts every real PricingModel value', () => {
    for (const model of ['one_time', 'monthly_subscription', 'annual_subscription', 'framework_agreement', 'campaign_based', 'per_user', 'per_product', 'per_event', 'custom_quotation']) {
      expect(isValidPricingModel(model)).toBe(true);
    }
  });

  it('rejects an unrecognized string', () => {
    expect(isValidPricingModel('yearly_thing')).toBe(false);
    expect(isValidPricingModel(undefined)).toBe(false);
  });
});

describe('sanitizeProduct', () => {
  it('returns null for a missing/blank name', () => {
    expect(sanitizeProduct('cogmap', 'default', { name: '', unitPrice: 100, pricingModel: 'one_time' }, { now: NOW })).toBeNull();
    expect(sanitizeProduct('cogmap', 'default', { name: '   ', unitPrice: 100, pricingModel: 'one_time' }, { now: NOW })).toBeNull();
  });

  it('returns null for a missing/non-positive unitPrice', () => {
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 0, pricingModel: 'one_time' }, { now: NOW })).toBeNull();
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: -5, pricingModel: 'one_time' }, { now: NOW })).toBeNull();
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', pricingModel: 'one_time' }, { now: NOW })).toBeNull();
  });

  it('returns null for an unrecognized pricingModel', () => {
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'yearly_thing' }, { now: NOW })).toBeNull();
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100 }, { now: NOW })).toBeNull();
  });

  it('clamps unitPrice to PRODUCT_ABSOLUTE_CEILING', () => {
    const product = sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 999_999_999, pricingModel: 'one_time' }, { now: NOW });
    expect(product?.unitPrice).toBe(PRODUCT_ABSOLUTE_CEILING);
  });

  it('defaults currency to USD for an invalid/missing value, accepts EUR', () => {
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time' }, { now: NOW })?.currency).toBe('USD');
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time', currency: 'GBP' }, { now: NOW })?.currency).toBe('USD');
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time', currency: 'EUR' }, { now: NOW })?.currency).toBe('EUR');
  });

  it('defaults active to true', () => {
    expect(sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time' }, { now: NOW })?.active).toBe(true);
  });

  it('strips control characters and clamps string length', () => {
    const product = sanitizeProduct('cogmap', 'default', { name: 'Widget\x00\x01', unitPrice: 100, pricingModel: 'one_time', description: 'x'.repeat(2000) }, { now: NOW });
    expect(product?.name).toBe('Widget');
    expect(product?.description.length).toBe(1000);
  });

  it('preserves createdAt/sourceProductLineId across an edit of an existing product', () => {
    const original = sanitizeProduct('cogmap', 'default', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time', sourceProductLineId: 'line-1' }, { now: NOW });
    const later = new Date(NOW.getTime() + 86_400_000);
    const edited = sanitizeProduct('cogmap', 'default', { name: 'Widget v2', unitPrice: 150, pricingModel: 'one_time' }, { now: later, existing: original });
    expect(edited?.createdAt).toBe(original?.createdAt);
    expect(edited?.sourceProductLineId).toBe('line-1');
    expect(edited?.name).toBe('Widget v2');
    expect(edited?.updatedAt).toBe(later.toISOString());
  });

  it('stamps brand and tenantId onto the product', () => {
    const product = sanitizeProduct('seyu', 'tenant-x', { name: 'Widget', unitPrice: 100, pricingModel: 'one_time' }, { now: NOW });
    expect(product?.brand).toBe('seyu');
    expect(product?.tenantId).toBe('tenant-x');
  });
});

describe('sanitizeProducts', () => {
  it('returns [] for a non-array input', () => {
    expect(sanitizeProducts('cogmap', 'default', null)).toEqual([]);
  });

  it('drops invalid rows while keeping valid ones', () => {
    const result = sanitizeProducts('cogmap', 'default', [
      { name: 'Valid', unitPrice: 100, pricingModel: 'one_time' },
      { name: '', unitPrice: 100, pricingModel: 'one_time' },
      { name: 'Also valid', unitPrice: 200, pricingModel: 'monthly_subscription' },
    ], null, NOW);
    expect(result).toHaveLength(2);
  });
});

describe('resolveProductLinePrice', () => {
  it('maps each pricingModel to its own ProductPricing field, preferring perUserTypical over perUserPrice', () => {
    const pricing = {
      oneTimePrice: 1, monthlyPrice: 2, annualPrice: 3, frameworkAnnualValue: 4, campaignPrice: 5,
      perUserPrice: 6, perUserTypical: 7, perProductPrice: 8, perEventPrice: 9, customQuotationTypicalValue: 10,
    };
    expect(resolveProductLinePrice(pricing, 'one_time')).toBe(1);
    expect(resolveProductLinePrice(pricing, 'monthly_subscription')).toBe(2);
    expect(resolveProductLinePrice(pricing, 'annual_subscription')).toBe(3);
    expect(resolveProductLinePrice(pricing, 'framework_agreement')).toBe(4);
    expect(resolveProductLinePrice(pricing, 'campaign_based')).toBe(5);
    expect(resolveProductLinePrice(pricing, 'per_user')).toBe(7);
    expect(resolveProductLinePrice(pricing, 'per_product')).toBe(8);
    expect(resolveProductLinePrice(pricing, 'per_event')).toBe(9);
    expect(resolveProductLinePrice(pricing, 'custom_quotation')).toBe(10);
  });

  it('falls back to perUserPrice when perUserTypical is absent', () => {
    expect(resolveProductLinePrice({ perUserPrice: 6 }, 'per_user')).toBe(6);
  });

  it('returns undefined for an undefined pricing object', () => {
    expect(resolveProductLinePrice(undefined, 'one_time')).toBeUndefined();
  });
});
