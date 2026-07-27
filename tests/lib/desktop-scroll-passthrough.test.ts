import { describe, it, expect } from 'vitest';
import { isVerticalScrollIntent } from '../../lib/desktop-scroll-passthrough';

describe('isVerticalScrollIntent', () => {
  it('is true for a pure vertical gesture', () => {
    expect(isVerticalScrollIntent(0, 50)).toBe(true);
  });

  it('is true for a vertical gesture with a small horizontal component (typical trackpad noise)', () => {
    expect(isVerticalScrollIntent(3, 50)).toBe(true);
  });

  it('is false for a pure horizontal gesture', () => {
    expect(isVerticalScrollIntent(50, 0)).toBe(false);
  });

  it('is false for a horizontal-dominant gesture', () => {
    expect(isVerticalScrollIntent(50, 3)).toBe(false);
  });

  it('is false when deltas are exactly equal (ties favor letting the horizontal container handle it)', () => {
    expect(isVerticalScrollIntent(20, 20)).toBe(false);
  });

  it('handles negative deltas (scroll-up / natural-scrolling direction) by magnitude, not sign', () => {
    expect(isVerticalScrollIntent(2, -50)).toBe(true);
    expect(isVerticalScrollIntent(-50, 2)).toBe(false);
  });

  it('is false for a no-op event (both deltas zero)', () => {
    expect(isVerticalScrollIntent(0, 0)).toBe(false);
  });
});
