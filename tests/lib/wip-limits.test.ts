import { describe, it, expect } from 'vitest';
import { DEFAULT_WIP_LIMITS, resolveWipThreshold, isOverWipLimit } from '../../lib/wip-limits';

describe('resolveWipThreshold (issue 213)', () => {
  it('uses the configured threshold when present', () => {
    expect(resolveWipThreshold('ENGAGED', { ENGAGED: 5 })).toBe(5);
  });

  it('falls back to DEFAULT_WIP_LIMITS when unconfigured', () => {
    expect(resolveWipThreshold('ENGAGED', undefined)).toBe(DEFAULT_WIP_LIMITS.ENGAGED);
    expect(resolveWipThreshold('ENGAGED', null)).toBe(DEFAULT_WIP_LIMITS.ENGAGED);
    expect(resolveWipThreshold('ENGAGED', {})).toBe(DEFAULT_WIP_LIMITS.ENGAGED);
  });

  it('returns undefined for a column with no default and no configured value', () => {
    expect(resolveWipThreshold('UNKNOWN_COLUMN', {})).toBeUndefined();
  });
});

describe('isOverWipLimit (issue 213)', () => {
  it('is false when count is at or below threshold', () => {
    expect(isOverWipLimit(10, 10)).toBe(false);
    expect(isOverWipLimit(9, 10)).toBe(false);
  });

  it('is true only once count strictly exceeds threshold', () => {
    expect(isOverWipLimit(11, 10)).toBe(true);
  });

  it('never triggers when the threshold is unset (undefined) — the default WON/LOST/BACKLOG state', () => {
    expect(isOverWipLimit(1000, undefined)).toBe(false);
  });

  it('never triggers on a zero threshold, even for a near-empty column (issue 213 §15 edge case)', () => {
    expect(isOverWipLimit(1, 0)).toBe(false);
    expect(isOverWipLimit(0, 0)).toBe(false);
  });

  it('WON/LOST/BACKLOG default to 0 (disabled) in DEFAULT_WIP_LIMITS', () => {
    expect(DEFAULT_WIP_LIMITS.WON).toBe(0);
    expect(DEFAULT_WIP_LIMITS.LOST).toBe(0);
    expect(DEFAULT_WIP_LIMITS.BACKLOG).toBe(0);
  });
});
