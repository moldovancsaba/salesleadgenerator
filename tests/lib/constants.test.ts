import { describe, it, expect } from 'vitest';
import { getTicketSize } from '../../app/constants';

describe('getTicketSize', () => {
  it('returns null when there is nothing to show at all', () => {
    expect(getTicketSize({})).toBeNull();
  });

  it('returns unconfigured for method: unconfigured', () => {
    expect(getTicketSize({ ticketSizeEstimate: { method: 'unconfigured' } })).toEqual({ kind: 'unconfigured' });
  });

  it('returns a full estimate for tier_band, passing sizeAssumed through', () => {
    const result = getTicketSize({
      ticketSizeEstimate: {
        method: 'tier_band',
        low: 5000,
        expected: 10000,
        high: 20000,
        currency: 'USD',
        confidence: 'low',
        sizeAssumed: true,
      },
    });
    expect(result).toEqual({
      kind: 'estimate',
      low: 5000,
      expected: 10000,
      high: 20000,
      currency: 'USD',
      method: 'tier_band',
      confidence: 'low',
      overrideReason: undefined,
      overriddenBy: undefined,
      sizeAssumed: true,
    });
  });

  // Issue #112 — the ordinary case where the lead's size tier is reliably
  // known: sizeAssumed must be undefined/falsy, not just omitted from a
  // stored estimate that predates this field.
  it('leaves sizeAssumed falsy for a normal, reliable estimate', () => {
    const result = getTicketSize({
      ticketSizeEstimate: {
        method: 'tier_band',
        low: 50000,
        expected: 100000,
        high: 200000,
        currency: 'USD',
        confidence: 'medium',
      },
    });
    expect(result?.kind).toBe('estimate');
    expect((result as any).sizeAssumed).toBeUndefined();
  });

  it('falls back to legacy estimated_annual_revenue_usd when there is no real ticketSizeEstimate', () => {
    expect(getTicketSize({ estimated_annual_revenue_usd: 42000 })).toEqual({
      kind: 'legacy',
      value: 42000,
      currency: 'USD',
    });
  });

  it('falls back to legacy pricingByCompany total when neither of the above exist', () => {
    const result = getTicketSize({
      pricingByCompany: { acme: { upfront_eur: 1000, monthly_eur: 500, annual_fee_eur: 0 } },
    });
    expect(result).toEqual({ kind: 'legacy', value: 7000, currency: 'EUR' }); // max(0, 500*12+1000)
  });
});
