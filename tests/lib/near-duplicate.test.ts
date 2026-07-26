import { describe, it, expect } from 'vitest';
import { normalizeForMatch, similarity, findCandidatePairs } from '../../lib/near-duplicate';

describe('normalizeForMatch', () => {
  it('lowercases and trims the name', () => {
    expect(normalizeForMatch('  Acme Corp  ', '').name).toBe('acme corp');
  });

  it('strips scheme, www, and path from the domain', () => {
    expect(normalizeForMatch('', 'https://www.acme.com/about').domain).toBe('acme.com');
    expect(normalizeForMatch('', 'http://acme.com').domain).toBe('acme.com');
  });
});

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('acme corp', 'acme corp')).toBe(1);
  });

  it('scores near-identical names highly', () => {
    expect(similarity('acme corp', 'acme corporation')).toBeGreaterThan(0.6);
  });

  it('scores unrelated names low', () => {
    expect(similarity('acme corp', 'zephyr sports academy')).toBeLessThan(0.3);
  });

  it('returns 0 for an empty input', () => {
    expect(similarity('', 'acme corp')).toBe(0);
  });
});

describe('findCandidatePairs', () => {
  it('flags a near-identical name pair above the threshold', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ leadIdA: '1', leadIdB: '2', matchedOn: 'name' });
  });

  it('flags a domain-only match even with a low name score', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Sports Division', url: 'https://www.acme.com/sports' },
      { _id: '2', entity_name: 'Zephyr Holdings', url: 'https://acme.com/zephyr' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].matchedOn).toBe('domain');
  });

  it('marks a pair matching on both name and domain as both', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'https://acme.com' },
      { _id: '2', entity_name: 'Acme Corp', url: 'https://www.acme.com/' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs[0].matchedOn).toBe('both');
  });

  it('does not flag unrelated leads', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme.com' },
      { _id: '2', entity_name: 'Totally Different Academy', url: 'different.org' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs).toHaveLength(0);
  });

  it('evaluates every pairwise combination across N leads, not just adjacent ones', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme.com' },
      { _id: '2', entity_name: 'Unrelated Co', url: 'unrelated.com' },
      { _id: '3', entity_name: 'Acme Corporation', url: 'acme-2.com' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ leadIdA: '1', leadIdB: '3' });
  });

  it('returns an empty array for fewer than 2 leads', () => {
    expect(findCandidatePairs([], 0.82)).toEqual([]);
    expect(findCandidatePairs([{ _id: '1', entity_name: 'Solo Co', url: 'solo.com' }], 0.82)).toEqual([]);
  });
});
