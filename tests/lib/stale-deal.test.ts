import { describe, it, expect } from 'vitest';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS } from '../../lib/stale-deal';

const NOW = new Date('2026-07-25T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('computeStaleness', () => {
  it('flags a deal exactly at the threshold as stale', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(10) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result).toEqual({ daysSince: 10, thresholdDays: 10, severity: 'stale' });
  });

  it('does not flag a deal one day under the threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(9) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result).toBeNull();
  });

  it('flips to critical severity at 2x the threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(20) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result).toEqual({ daysSince: 20, thresholdDays: 10, severity: 'critical' });
  });

  it('stays stale one day under the critical boundary', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(19) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result?.severity).toBe('stale');
  });

  it('returns null when updatedAt is missing', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL' },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null when updatedAt is invalid', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: 'not-a-date' },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(result).toBeNull();
  });

  it('applies different thresholds per column for identical daysSince', () => {
    const engaged = computeStaleness(
      { kanbanColumn: 'ENGAGED', updatedAt: daysAgo(14) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    const proposal = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(14) },
      DEFAULT_STALE_THRESHOLDS,
      NOW
    );
    expect(engaged).toBeNull();
    expect(proposal).toEqual({ daysSince: 14, thresholdDays: 10, severity: 'stale' });
  });

  it('never flags WON regardless of an absurdly low threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'WON', updatedAt: daysAgo(365) },
      { WON: 1 },
      NOW
    );
    expect(result).toBeNull();
  });

  it('never flags LOST regardless of an absurdly low threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'LOST', updatedAt: daysAgo(365) },
      { LOST: 1 },
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null for a zero threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(365) },
      { PROPOSAL: 0 },
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null for a negative threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(365) },
      { PROPOSAL: -5 },
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null for a NaN threshold', () => {
    const result = computeStaleness(
      { kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(365) },
      { PROPOSAL: NaN },
      NOW
    );
    expect(result).toBeNull();
  });

  it('falls back to DEFAULT_STALE_THRESHOLDS when a column key is missing from the supplied thresholds', () => {
    const result = computeStaleness(
      { kanbanColumn: 'ENGAGED', updatedAt: daysAgo(21) },
      {},
      NOW
    );
    expect(result).toEqual({ daysSince: 21, thresholdDays: 21, severity: 'stale' });
  });
});
