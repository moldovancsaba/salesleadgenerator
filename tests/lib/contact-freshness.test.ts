import { describe, it, expect } from 'vitest';
import { isContactStale, staleContactRatio } from '../../lib/contact-freshness';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const THRESHOLD = 180;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('isContactStale', () => {
  it('treats missing lastVerifiedAt as stale', () => {
    expect(isContactStale({}, THRESHOLD, NOW)).toBe(true);
  });

  it('is stale exactly at the threshold boundary (inclusive)', () => {
    expect(isContactStale({ lastVerifiedAt: daysAgo(180) }, THRESHOLD, NOW)).toBe(true);
  });

  it('is not stale one ms under the threshold', () => {
    const justUnder = new Date(NOW.getTime() - THRESHOLD * 86_400_000 + 1).toISOString();
    expect(isContactStale({ lastVerifiedAt: justUnder }, THRESHOLD, NOW)).toBe(false);
  });

  it('treats a future timestamp (clock skew) as not stale', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(isContactStale({ lastVerifiedAt: future }, THRESHOLD, NOW)).toBe(false);
  });

  it('treats an invalid lastVerifiedAt as stale', () => {
    expect(isContactStale({ lastVerifiedAt: 'not-a-date' }, THRESHOLD, NOW)).toBe(true);
  });
});

describe('staleContactRatio', () => {
  it('returns 0 for an empty array (not 100% stale)', () => {
    expect(staleContactRatio([], THRESHOLD, NOW)).toBe(0);
  });

  it('returns a correct mixed fresh/stale ratio', () => {
    const contacts = [
      { lastVerifiedAt: daysAgo(1) },
      { lastVerifiedAt: daysAgo(200) },
      {},
      { lastVerifiedAt: daysAgo(10) },
    ];
    expect(staleContactRatio(contacts, THRESHOLD, NOW)).toBe(0.5);
  });

  it('returns 1 when every contact is stale', () => {
    const contacts = [{ lastVerifiedAt: daysAgo(365) }, {}];
    expect(staleContactRatio(contacts, THRESHOLD, NOW)).toBe(1);
  });

  it('returns 0 when every contact is fresh', () => {
    const contacts = [{ lastVerifiedAt: daysAgo(1) }, { lastVerifiedAt: daysAgo(2) }];
    expect(staleContactRatio(contacts, THRESHOLD, NOW)).toBe(0);
  });
});
