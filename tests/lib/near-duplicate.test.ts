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

  // Issue #137: found while investigating why real production duplicates
  // (case-only and diacritic-only name variants) weren't being caught by
  // findCandidatePairs()'s bigram threshold.
  it('folds diacritics so an accented and unaccented spelling normalize identically', () => {
    expect(normalizeForMatch('Fenerbahçe', '').name).toBe(normalizeForMatch('Fenerbahce', '').name);
    expect(normalizeForMatch('Fenerbahçe', '').name).toBe('fenerbahce');
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
  it('flags a near-identical name pair above the threshold when sport_or_sector matches', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ leadIdA: '1', leadIdB: '2', matchedOn: 'name' });
  });

  it('sport_or_sector match is case-insensitive and trims whitespace', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: '  Soccer ' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com', sport_or_sector: 'SOCCER' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
  });

  // Owner requirement, 2026-07-28: an organization's soccer section and its
  // handball section are two different leads, not duplicates — regardless
  // of near-identical names or a shared domain.
  it('never flags a pair with different sport_or_sector, however similar the names', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Sports Club', url: 'acme.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Sports Club', url: 'acme.com', sport_or_sector: 'Handball' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(0);
  });

  it('never flags a pair where either side has no sport_or_sector recorded', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(0);
  });

  // Owner requirement, 2026-07-28: "One lead can have multiple domains" —
  // domain match alone must never be sufficient to flag a pair; a low name
  // score with a shared domain is not a duplicate candidate.
  it('does not flag a low name score just because the domain matches', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Sports Division', url: 'https://www.acme.com/sports', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Zephyr Holdings', url: 'https://acme.com/zephyr', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs).toHaveLength(0);
  });

  it('marks a pair matching on both name and domain as both', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'https://acme.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Corp', url: 'https://www.acme.com/', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs[0].matchedOn).toBe('both');
  });

  it('marks a pair matching on name only (different domains) as name', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'https://acme.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Corp', url: 'https://acme-other-domain.com', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs[0].matchedOn).toBe('name');
  });

  it('does not flag unrelated leads', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Totally Different Academy', url: 'different.org', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.82);
    expect(pairs).toHaveLength(0);
  });

  it('evaluates every pairwise combination across N leads, not just adjacent ones', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Unrelated Co', url: 'unrelated.com', sport_or_sector: 'Soccer' },
      { _id: '3', entity_name: 'Acme Corporation', url: 'acme-2.com', sport_or_sector: 'Soccer' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ leadIdA: '1', leadIdB: '3' });
  });

  it('returns an empty array for fewer than 2 leads', () => {
    expect(findCandidatePairs([], 0.82)).toEqual([]);
    expect(findCandidatePairs([{ _id: '1', entity_name: 'Solo Co', url: 'solo.com', sport_or_sector: 'Soccer' }], 0.82)).toEqual([]);
  });

  // Rulebook v1.0 rollout, 2026-07-28: real production data stores the same
  // sport as "Soccer"/"Football"/"Football (Soccer)" interchangeably — the
  // alias table must unify these so genuine duplicates aren't split apart.
  it('resolves sport_or_sector aliases so "Soccer" and "Football" are treated as the same sport', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: 'Soccer' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com', sport_or_sector: 'Football' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
  });

  it('prefers the controlled sportCode over sport_or_sector when both are present', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: 'Soccer', sportCode: 'basketball' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com', sport_or_sector: 'Soccer', sportCode: 'handball' },
    ];
    // sport_or_sector matches on both sides ("Soccer") but the controlled
    // sportCode values disagree — sportCode wins, so this must not match.
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(0);
  });

  it('falls back to sport_or_sector when sportCode is not a valid controlled code', () => {
    const leads = [
      { _id: '1', entity_name: 'Acme Corp', url: 'acme-corp.com', sport_or_sector: 'Soccer', sportCode: 'not-a-real-code' },
      { _id: '2', entity_name: 'Acme Corporation', url: 'acme-corporation.com', sport_or_sector: 'Football', sportCode: '' },
    ];
    const pairs = findCandidatePairs(leads, 0.7);
    expect(pairs).toHaveLength(1);
  });

  // Issue #137: real production duplicates missed by the pre-fix algorithm.
  // Both cases score below the default 0.82 bigram threshold even after
  // lowercasing alone — confirmed via a standalone Dice-coefficient
  // computation before writing this fix (diacritic pair: 0.778, spacing
  // pair: 0.727).
  describe('real duplicates found in production (issue #137)', () => {
    it('flags a diacritic-only variant at the default threshold', () => {
      const leads = [
        { _id: '1', entity_name: 'Fenerbahçe', url: 'fenerbahce.org', sport_or_sector: 'Soccer' },
        { _id: '2', entity_name: 'Fenerbahce', url: 'fenerbahce.org/en', sport_or_sector: 'Soccer' },
      ];
      const pairs = findCandidatePairs(leads);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].score).toBe(1);
    });

    it('flags a spacing-only variant ("La Liga" vs "LaLiga") at the default threshold', () => {
      const leads = [
        { _id: '1', entity_name: 'La Liga', url: 'laliga.com', sport_or_sector: 'Soccer' },
        { _id: '2', entity_name: 'LaLiga', url: 'laliga.es', sport_or_sector: 'Soccer' },
      ];
      const pairs = findCandidatePairs(leads);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].score).toBe(1);
    });

    it('flags a punctuation-only variant ("U.S. Soccer Federation" vs "US Soccer Federation")', () => {
      const leads = [
        { _id: '1', entity_name: 'U.S. Soccer Federation', url: 'ussoccer.com', sport_or_sector: 'Soccer' },
        { _id: '2', entity_name: 'US Soccer Federation', url: 'ussoccer.com/about', sport_or_sector: 'Soccer' },
      ];
      const pairs = findCandidatePairs(leads);
      expect(pairs).toHaveLength(1);
    });

    it('still never flags a tight-key match across different sport_or_sector (the hard gate still applies)', () => {
      const leads = [
        { _id: '1', entity_name: 'La Liga', url: 'laliga.com', sport_or_sector: 'Soccer' },
        { _id: '2', entity_name: 'LaLiga', url: 'laliga.es', sport_or_sector: 'Basketball' },
      ];
      const pairs = findCandidatePairs(leads);
      expect(pairs).toHaveLength(0);
    });

    // A different-letter-order acronym shares no tight-key equality (tight
    // keys are alphanumeric-stripped, not sorted/anagram-normalized) and
    // scores low on bigrams too — confirms this fix doesn't loosen matching
    // for genuinely unrelated short names.
    it('does not flag two different acronyms sharing the same letters in a different order', () => {
      const leads = [
        { _id: '1', entity_name: 'AFC', url: 'afc.com', sport_or_sector: 'Soccer' },
        { _id: '2', entity_name: 'FCA', url: 'fca.com', sport_or_sector: 'Soccer' },
      ];
      const pairs = findCandidatePairs(leads);
      expect(pairs).toHaveLength(0);
    });
  });
});
