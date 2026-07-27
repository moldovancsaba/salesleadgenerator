import { describe, it, expect } from 'vitest';
import { sanitizeDeal, sanitizeDeals, sumDeals } from '../../lib/deals';

const NOW = new Date('2026-07-27T00:00:00.000Z');

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
