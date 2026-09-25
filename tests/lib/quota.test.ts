import { describe, it, expect } from 'vitest';
import {
  isValidPeriod,
  periodToDateRange,
  dealValueForLead,
  computeAttainmentFromWonLeads,
  computeAttainmentPercent,
} from '../../lib/quota';

describe('isValidPeriod', () => {
  it('validates monthly periods (YYYY-MM)', () => {
    expect(isValidPeriod('2026-09', 'monthly')).toBe(true);
    expect(isValidPeriod('2026-13', 'monthly')).toBe(false);
    expect(isValidPeriod('2026-00', 'monthly')).toBe(false);
    expect(isValidPeriod('2026-9', 'monthly')).toBe(false);
  });

  it('validates quarterly periods (YYYY-QN)', () => {
    expect(isValidPeriod('2026-Q3', 'quarterly')).toBe(true);
    expect(isValidPeriod('2026-Q5', 'quarterly')).toBe(false);
    expect(isValidPeriod('2026-Q0', 'quarterly')).toBe(false);
  });

  it('validates annual periods (YYYY)', () => {
    expect(isValidPeriod('2026', 'annual')).toBe(true);
    expect(isValidPeriod('26', 'annual')).toBe(false);
  });

  it('rejects a non-string period and a mismatched periodType', () => {
    expect(isValidPeriod(2026 as unknown as string, 'annual')).toBe(false);
    expect(isValidPeriod('2026-Q3', 'monthly')).toBe(false);
  });
});

describe('periodToDateRange', () => {
  it('computes a monthly range in UTC, including the December year-rollover', () => {
    expect(periodToDateRange('2026-09', 'monthly')).toEqual({
      start: new Date(Date.UTC(2026, 8, 1)),
      end: new Date(Date.UTC(2026, 9, 1)),
    });
    expect(periodToDateRange('2026-12', 'monthly')).toEqual({
      start: new Date(Date.UTC(2026, 11, 1)),
      end: new Date(Date.UTC(2027, 0, 1)),
    });
  });

  it('computes a quarterly range, including the Q4 year-rollover', () => {
    expect(periodToDateRange('2026-Q1', 'quarterly')).toEqual({
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2026, 3, 1)),
    });
    expect(periodToDateRange('2026-Q4', 'quarterly')).toEqual({
      start: new Date(Date.UTC(2026, 9, 1)),
      end: new Date(Date.UTC(2027, 0, 1)),
    });
  });

  it('computes an annual range', () => {
    expect(periodToDateRange('2026', 'annual')).toEqual({
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2027, 0, 1)),
    });
  });

  it('returns null for an invalid period', () => {
    expect(periodToDateRange('not-a-period', 'monthly')).toBeNull();
  });
});

describe('dealValueForLead', () => {
  it('prefers actualDealValueUsd when present', () => {
    expect(dealValueForLead({ actualDealValueUsd: 5000, ticketSizeEstimate: { expected: 9999 } })).toBe(5000);
  });

  it('falls back to a deals[] sum when actualDealValueUsd is absent', () => {
    expect(dealValueForLead({ deals: [{ value: 100 }, { value: 200 }] })).toBe(300);
  });

  it('falls back to ticketSizeEstimate.expected when no actual/deals value exists', () => {
    expect(dealValueForLead({ ticketSizeEstimate: { expected: 750 } })).toBe(750);
  });

  it('falls back to estimated_annual_revenue_usd as the last resort', () => {
    expect(dealValueForLead({ estimated_annual_revenue_usd: 300 })).toBe(300);
  });

  it('returns 0 for a lead with no value signal at all', () => {
    expect(dealValueForLead({})).toBe(0);
  });
});

describe('computeAttainmentFromWonLeads', () => {
  const range = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') };

  it('sums only entries whose wonAt falls within [start, end)', () => {
    const result = computeAttainmentFromWonLeads(
      [
        { leadId: 'a', wonAt: new Date('2026-09-15T00:00:00Z'), value: 1000 },
        { leadId: 'b', wonAt: new Date('2026-08-31T23:59:59Z'), value: 5000 }, // before range
        { leadId: 'c', wonAt: new Date('2026-10-01T00:00:00Z'), value: 5000 }, // end is exclusive
        { leadId: 'd', wonAt: new Date('2026-09-01T00:00:00Z'), value: 2000 }, // start is inclusive
      ],
      range
    );
    expect(result.attained).toBe(3000);
    expect(result.leadCount).toBe(2);
  });

  it('returns zero for an empty list', () => {
    expect(computeAttainmentFromWonLeads([], range)).toEqual({ attained: 0, leadCount: 0 });
  });
});

describe('computeAttainmentPercent', () => {
  it('computes a rounded percentage to 2 decimal places', () => {
    expect(computeAttainmentPercent(333, 1000)).toBe(33.3);
  });

  it('returns null when no quota is set', () => {
    expect(computeAttainmentPercent(500, null)).toBeNull();
  });

  it('returns null for a zero or negative quota rather than dividing by zero', () => {
    expect(computeAttainmentPercent(500, 0)).toBeNull();
    expect(computeAttainmentPercent(500, -10)).toBeNull();
  });
});
