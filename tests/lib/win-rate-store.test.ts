import { describe, it, expect } from 'vitest';
import { isStale } from '../../app/lib/win-rate-store';
import type { WinRateDoc } from '../../app/lib/win-rate-store';

// fetchOutcomeLogs/computeAndPersistWinRates/getCachedWinRates/getOrRecomputeWinRates
// all touch Mongo directly and are not unit tested here for the same
// documented reason as every other Mongo-touching module in this repo
// (mongodb-memory-server's binary download is blocked by this sandbox's
// network policy) — only the pure staleness boundary (isStale) is tested.

const NOW = new Date('2026-07-25T12:00:00.000Z');

function docAt(computedAt: Date): WinRateDoc {
  return { tenantId: 'default', brand: 'cogmap', stages: {} as any, computedAt, windowDays: null, minSampleSize: 20 };
}

describe('isStale', () => {
  it('treats a missing doc as stale', () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it('treats a doc computed just under 24h ago as fresh', () => {
    const doc = docAt(new Date(NOW.getTime() - 23 * 60 * 60 * 1000));
    expect(isStale(doc, NOW)).toBe(false);
  });

  it('treats a doc computed more than 24h ago as stale', () => {
    const doc = docAt(new Date(NOW.getTime() - 25 * 60 * 60 * 1000));
    expect(isStale(doc, NOW)).toBe(true);
  });

  it('treats a doc computed exactly 24h ago as not-yet-stale (strict greater-than boundary)', () => {
    const doc = docAt(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
    expect(isStale(doc, NOW)).toBe(false);
  });
});
