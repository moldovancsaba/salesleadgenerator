import { describe, it, expect } from 'vitest';
import { shouldShowWinProbability } from '../../lib/card-tiering';

describe('shouldShowWinProbability (issue 213)', () => {
  it('shows a finite numeric probability on a non-terminal lead', () => {
    expect(shouldShowWinProbability(false, 0.42)).toBe(true);
  });

  it('never shows a probability on a terminal (WON/LOST) lead, even if one was passed', () => {
    expect(shouldShowWinProbability(true, 0.9)).toBe(false);
  });

  it('never shows when no forecast data is loaded (undefined/null)', () => {
    expect(shouldShowWinProbability(false, undefined)).toBe(false);
    expect(shouldShowWinProbability(false, null)).toBe(false);
  });

  it('never shows a non-finite value', () => {
    expect(shouldShowWinProbability(false, NaN)).toBe(false);
    expect(shouldShowWinProbability(false, Infinity)).toBe(false);
  });

  it('shows a genuine 0 probability (a real, meaningful value, not "absent")', () => {
    expect(shouldShowWinProbability(false, 0)).toBe(true);
  });
});
