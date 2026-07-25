import { describe, it, expect } from 'vitest';
import { computeConcentration, DEFAULT_CONCENTRATION_THRESHOLD, DEFAULT_CONCENTRATION_TOP_N } from '../../lib/forecast-concentration';

describe('computeConcentration', () => {
  it('flags a single dominant deal (90% of column total) as at risk', () => {
    const result = computeConcentration(
      [{ leadId: 'a', entityName: 'Big Co', value: 900 }, { leadId: 'b', entityName: 'Small Co', value: 100 }],
      1000,
      2
    );
    expect(result).toMatchObject({ topLeadId: 'a', topLeadName: 'Big Co', topLeadValue: 900, percentOfTotal: 0.9, atRisk: true });
  });

  it('does not flag an evenly distributed pipeline', () => {
    const result = computeConcentration(
      [{ leadId: 'a', entityName: 'A', value: 250 }, { leadId: 'b', entityName: 'B', value: 250 }, { leadId: 'c', entityName: 'C', value: 250 }, { leadId: 'd', entityName: 'D', value: 250 }],
      1000,
      4
    );
    expect(result?.percentOfTotal).toBe(0.25);
    expect(result?.atRisk).toBe(false);
  });

  it('returns null for an empty column', () => {
    expect(computeConcentration([], 0, 0)).toBeNull();
  });

  it('returns null when totalValue is zero even if leadValues is non-empty (e.g. all zero-value leads)', () => {
    expect(computeConcentration([{ leadId: 'a', entityName: 'A', value: 0 }], 0, 1)).toBeNull();
  });

  it('flags exactly at the threshold boundary (inclusive >=)', () => {
    const result = computeConcentration(
      [{ leadId: 'a', entityName: 'A', value: 300 }, { leadId: 'b', entityName: 'B', value: 700 }],
      1000,
      2,
      0.3
    );
    expect(result?.percentOfTotal).toBe(0.7);
    // topLead here is 'b' at 700/1000 = 0.7, exactly at a 0.3 threshold comparison of 0.7 >= 0.3
    expect(result?.atRisk).toBe(true);
  });

  it('does not flag a single-lead column even at 100% concentration', () => {
    const result = computeConcentration([{ leadId: 'a', entityName: 'Only Deal', value: 500 }], 500, 1);
    expect(result?.percentOfTotal).toBe(1);
    expect(result?.atRisk).toBe(false);
  });

  it('breaks ties on tied largest deals deterministically (value desc, then leadId asc)', () => {
    const result = computeConcentration(
      [{ leadId: 'z-lead', entityName: 'Z Corp', value: 500 }, { leadId: 'a-lead', entityName: 'A Corp', value: 500 }],
      1000,
      2
    );
    expect(result?.topLeadId).toBe('a-lead');
    expect(result?.topLeadName).toBe('A Corp');
  });

  it('excludes zero/negative-value leads from both numerator and denominator ranking', () => {
    const result = computeConcentration(
      [{ leadId: 'a', entityName: 'A', value: 100 }, { leadId: 'b', entityName: 'B', value: 0 }, { leadId: 'c', entityName: 'C', value: -50 }],
      100,
      3
    );
    expect(result?.topLeadId).toBe('a');
    expect(result?.percentOfTotal).toBe(1);
  });

  it('supports topN > 1, summing the top N leads for percentOfTotal', () => {
    const result = computeConcentration(
      [{ leadId: 'a', entityName: 'A', value: 400 }, { leadId: 'b', entityName: 'B', value: 300 }, { leadId: 'c', entityName: 'C', value: 300 }],
      1000,
      3,
      DEFAULT_CONCENTRATION_THRESHOLD,
      2
    );
    expect(result?.percentOfTotal).toBe(0.7); // (400+300)/1000
    expect(result?.topN).toBe(2);
  });

  it('uses the documented defaults when threshold/topN are omitted', () => {
    const result = computeConcentration([{ leadId: 'a', entityName: 'A', value: 100 }], 100, 1);
    expect(result?.threshold).toBe(DEFAULT_CONCENTRATION_THRESHOLD);
    expect(result?.topN).toBe(DEFAULT_CONCENTRATION_TOP_N);
  });
});
