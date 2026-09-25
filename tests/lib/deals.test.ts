import { describe, it, expect } from 'vitest';
import { sanitizeDeal, sanitizeDeals, sumDeals } from '../../lib/deals';
import type { ProductPriceLookup } from '../../lib/deals';

const NOW = new Date('2026-07-27T00:00:00.000Z');

function lookup(entries: Array<[string, { unitPrice: number; currency: 'USD' | 'EUR' }]>): ProductPriceLookup {
  return new Map(entries);
}

describe('sanitizeDeal', () => {
  it('returns null for a missing/non-positive value', () => {
    expect(sanitizeDeal({ value: 0 }, { now: NOW })).toBeNull();
    expect(sanitizeDeal({ value: -5 }, { now: NOW })).toBeNull();
    expect(sanitizeDeal({}, { now: NOW })).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(sanitizeDeal(null as any, { now: NOW })).toBeNull();
    expect(sanitizeDeal(undefined as any, { now: NOW })).toBeNull();
  });

  it('clamps an implausible value to the absolute ceiling', () => {
    const deal = sanitizeDeal({ value: 999_999_999 }, { now: NOW });
    expect(deal?.value).toBe(50_000_000);
  });

  it('defaults currency to USD for an invalid/missing value', () => {
    expect(sanitizeDeal({ value: 1000 }, { now: NOW })?.currency).toBe('USD');
    expect(sanitizeDeal({ value: 1000, currency: 'GBP' }, { now: NOW })?.currency).toBe('USD');
  });

  it('accepts EUR', () => {
    expect(sanitizeDeal({ value: 1000, currency: 'EUR' }, { now: NOW })?.currency).toBe('EUR');
  });

  it('defaults source to manual', () => {
    expect(sanitizeDeal({ value: 1000 }, { now: NOW })?.source).toBe('manual');
  });

  it('accepts converted_ticket_estimate as a source', () => {
    expect(sanitizeDeal({ value: 1000, source: 'converted_ticket_estimate' }, { now: NOW })?.source).toBe('converted_ticket_estimate');
  });

  it('preserves createdAt and source across an edit of an existing deal', () => {
    const original = sanitizeDeal({ value: 1000, source: 'converted_ticket_estimate' }, { now: NOW });
    const later = new Date(NOW.getTime() + 86_400_000);
    const edited = sanitizeDeal({ value: 2000 }, { now: later, existing: original });
    expect(edited?.createdAt).toBe(original?.createdAt);
    expect(edited?.source).toBe('converted_ticket_estimate');
    expect(edited?.value).toBe(2000);
    expect(edited?.updatedAt).toBe(later.toISOString());
  });

  it('trims and caps label length', () => {
    const deal = sanitizeDeal({ value: 1000, label: '  Renewal  ' }, { now: NOW });
    expect(deal?.label).toBe('Renewal');
  });

  it('omits an empty label rather than storing an empty string', () => {
    const deal = sanitizeDeal({ value: 1000, label: '   ' }, { now: NOW });
    expect(deal?.label).toBeUndefined();
  });
});

describe('sanitizeDeal — catalog line items (issue 215)', () => {
  it('computes value as the worked-example total from §12 (1×45,000 + 3×6,500)', () => {
    const products = lookup([
      ['sponsorship__annual_subscription', { unitPrice: 45000, currency: 'USD' }],
      ['activation__per_event', { unitPrice: 7200, currency: 'USD' }],
    ]);
    const deal = sanitizeDeal({
      currency: 'USD',
      lineItems: [
        { productId: 'sponsorship__annual_subscription', quantity: 1 },
        { productId: 'activation__per_event', quantity: 3, unitPriceOverride: 6500 },
      ],
    }, { now: NOW, productLookup: products });
    expect(deal?.value).toBe(64500);
    expect(deal?.source).toBe('catalog_line_items');
    expect(deal?.lineItems).toEqual([
      { productId: 'sponsorship__annual_subscription', quantity: 1, unitPriceOverride: 45000 },
      { productId: 'activation__per_event', quantity: 3, unitPriceOverride: 6500 },
    ]);
  });

  it('drops a line item with an unknown productId, keeping the rest', () => {
    const products = lookup([['known', { unitPrice: 100, currency: 'USD' }]]);
    const deal = sanitizeDeal({
      currency: 'USD',
      lineItems: [{ productId: 'unknown', quantity: 1 }, { productId: 'known', quantity: 2 }],
    }, { now: NOW, productLookup: products });
    expect(deal?.lineItems).toEqual([{ productId: 'known', quantity: 2, unitPriceOverride: 100 }]);
    expect(deal?.value).toBe(200);
  });

  it('drops a line item whose quantity is zero, negative, or non-numeric', () => {
    const products = lookup([['p', { unitPrice: 100, currency: 'USD' }]]);
    for (const quantity of [0, -1, 'abc', NaN]) {
      const deal = sanitizeDeal({ currency: 'USD', lineItems: [{ productId: 'p', quantity }] }, { now: NOW, productLookup: products });
      expect(deal).toBeNull();
    }
  });

  it('drops a line item whose product currency does not match the deal currency, never converts it (§15 #4)', () => {
    const products = lookup([['eur-product', { unitPrice: 100, currency: 'EUR' }]]);
    const deal = sanitizeDeal({ currency: 'USD', lineItems: [{ productId: 'eur-product', quantity: 1 }] }, { now: NOW, productLookup: products });
    expect(deal).toBeNull();
  });

  it('falls back to the bare value when every lineItems entry is invalid (§15 #8)', () => {
    const products = lookup([]);
    const deal = sanitizeDeal({ currency: 'USD', value: 5000, lineItems: [{ productId: 'nope', quantity: 1 }] }, { now: NOW, productLookup: products });
    expect(deal?.value).toBe(5000);
    expect(deal?.source).toBe('manual');
    expect(deal?.lineItems).toBeUndefined();
  });

  it('treats lineItems: [] identically to omitted — falls back to the bare value', () => {
    const products = lookup([]);
    const deal = sanitizeDeal({ currency: 'USD', value: 3000, lineItems: [] }, { now: NOW, productLookup: products });
    expect(deal?.value).toBe(3000);
    expect(deal?.lineItems).toBeUndefined();
  });

  it('the resolved line-item total always wins over a sent value, never the other way around (§15 #9)', () => {
    const products = lookup([['p', { unitPrice: 1000, currency: 'USD' }]]);
    const deal = sanitizeDeal({ currency: 'USD', value: 999999, lineItems: [{ productId: 'p', quantity: 1 }] }, { now: NOW, productLookup: products });
    expect(deal?.value).toBe(1000);
  });

  it('clamps a catalog-derived total to the same ABSOLUTE_CEILING as a manual deal', () => {
    const products = lookup([['expensive', { unitPrice: 60_000_000, currency: 'USD' }]]);
    const deal = sanitizeDeal({ currency: 'USD', lineItems: [{ productId: 'expensive', quantity: 1 }] }, { now: NOW, productLookup: products });
    expect(deal?.value).toBe(50_000_000);
  });

  it('a deal without a productLookup ignores lineItems entirely and behaves exactly as before issue 215', () => {
    const deal = sanitizeDeal({ value: 4000, lineItems: [{ productId: 'p', quantity: 1 }] }, { now: NOW });
    expect(deal?.value).toBe(4000);
    expect(deal?.source).toBe('manual');
    expect(deal?.lineItems).toBeUndefined();
  });

  it('downgrades a catalog_line_items deal to manual when a later save no longer resolves any line items', () => {
    const products = lookup([['p', { unitPrice: 100, currency: 'USD' }]]);
    const original = sanitizeDeal({ currency: 'USD', lineItems: [{ productId: 'p', quantity: 1 }] }, { now: NOW, productLookup: products });
    const edited = sanitizeDeal({ value: 500 }, { now: NOW, existing: original });
    expect(edited?.source).toBe('manual');
    expect(edited?.lineItems).toBeUndefined();
  });
});

describe('sanitizeDeals', () => {
  it('returns [] for a non-array input', () => {
    expect(sanitizeDeals(null, [], NOW)).toEqual([]);
    expect(sanitizeDeals('not-an-array', [], NOW)).toEqual([]);
  });

  it('drops invalid rows while keeping valid ones', () => {
    const result = sanitizeDeals([{ value: 1000 }, { value: -1 }, { value: 2000 }], [], NOW);
    expect(result).toHaveLength(2);
  });
});

describe('sumDeals', () => {
  it('returns 0 for an empty/missing array', () => {
    expect(sumDeals(undefined)).toBe(0);
    expect(sumDeals(null)).toBe(0);
    expect(sumDeals([])).toBe(0);
  });

  it('sums multiple deals', () => {
    const deals = sanitizeDeals([{ value: 1000 }, { value: 2500 }], [], NOW);
    expect(sumDeals(deals)).toBe(3500);
  });
});
