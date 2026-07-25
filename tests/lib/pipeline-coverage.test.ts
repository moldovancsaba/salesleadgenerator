import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../../lib/pipeline-coverage';

describe('computeCoverage', () => {
  it('returns null, not 0, when no target is set', () => {
    expect(computeCoverage(undefined, 100000, 'USD')).toBeNull();
    expect(computeCoverage(null, 100000, 'USD')).toBeNull();
  });

  it('treats a target of 0 as no-target (no divide-by-zero, no false 0% alarm)', () => {
    expect(computeCoverage({ amount: 0, currency: 'USD', period: 'annual' }, 100000, 'USD')).toBeNull();
  });

  it('treats a negative target the same as no-target', () => {
    expect(computeCoverage({ amount: -500, currency: 'USD', period: 'annual' }, 100000, 'USD')).toBeNull();
  });

  it('flags exactly 3x weighted pipeline as the inclusive lower in_range boundary', () => {
    const result = computeCoverage({ amount: 10000, currency: 'USD', period: 'annual' }, 30000, 'USD');
    expect(result?.ratio).toBe(3);
    expect(result?.benchmark).toBe('in_range');
  });

  it('flags exactly 5x weighted pipeline as the inclusive upper in_range boundary', () => {
    const result = computeCoverage({ amount: 10000, currency: 'USD', period: 'annual' }, 50000, 'USD');
    expect(result?.ratio).toBe(5);
    expect(result?.benchmark).toBe('in_range');
  });

  it('flags just under 3x as below', () => {
    const result = computeCoverage({ amount: 10000, currency: 'USD', period: 'annual' }, 29900, 'USD');
    expect(result?.benchmark).toBe('below');
  });

  it('flags just over 5x as above', () => {
    const result = computeCoverage({ amount: 10000, currency: 'USD', period: 'annual' }, 50100, 'USD');
    expect(result?.benchmark).toBe('above');
  });

  it('returns an explicit ratio: 0 / below for zero weighted pipeline with a target set, not hidden', () => {
    const result = computeCoverage({ amount: 10000, currency: 'USD', period: 'annual' }, 0, 'USD');
    expect(result).not.toBeNull();
    expect(result?.ratio).toBe(0);
    expect(result?.benchmark).toBe('below');
  });

  it('never auto-converts a currency mismatch — flags unset and currencyMismatch: true', () => {
    const result = computeCoverage({ amount: 10000, currency: 'EUR', period: 'annual' }, 50000, 'USD');
    expect(result?.currencyMismatch).toBe(true);
    expect(result?.benchmark).toBe('unset');
    // The ratio is still computed (not hidden) even though the benchmark is unset —
    // a mismatched-currency number is still informative once the user is warned.
    expect(result?.ratio).toBe(5);
  });

  it('carries target metadata through unchanged', () => {
    const result = computeCoverage({ amount: 25000, currency: 'EUR', period: 'quarterly' }, 50000, 'EUR');
    expect(result).toMatchObject({ target: 25000, targetPeriod: 'quarterly', targetCurrency: 'EUR', weightedPipeline: 50000 });
  });
});
