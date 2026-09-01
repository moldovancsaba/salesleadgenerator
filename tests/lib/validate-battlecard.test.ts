import { describe, it, expect } from 'vitest';
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../app/lib/battlecards/validate-battlecard';
import { findForbiddenBrandTerms } from '../../lib/validate-lead';

// Issue #195 — findForbiddenBrandTerms no longer looks a brand up itself
// (FORBIDDEN_BRAND_TERMS was replaced by app/lib/brand.ts's Mongo-backed,
// derived getForbiddenTermsFor()); it just filters a given terms list
// against text. These literal lists mirror app/lib/brand.ts's
// FALLBACK_BRAND_CONFIG fixture's ownNameTerms unioned across the other two
// brands, so the same real-world scenarios these tests always covered stay
// covered. The derivation itself (that the union is computed correctly and
// stays symmetric with zero manual upkeep) is tested in tests/lib/brand.test.ts.
const COGMAP_FORBIDDEN = ['seyu', 'fan selfie', 'led screen', 'jumbotron', 'sponsor activation', 'revenue-share', 'revenue share', 'second screen', 'second-screen', 'dvsc'];
const SEYU_FORBIDDEN = ['cogmap', 'cognitive assessment', 'player performance analytics', 'decision-making profiling', 'sports science', 'situational awareness', 'dvsc'];
const DVSC_FORBIDDEN = [...COGMAP_FORBIDDEN.filter((t) => t !== 'dvsc'), ...SEYU_FORBIDDEN.filter((t) => t !== 'dvsc')];

describe('findForbiddenBrandTerms', () => {
  it('flags a CogMap-forbidden Seyu term', () => {
    expect(findForbiddenBrandTerms('We are basically Seyu for academies', COGMAP_FORBIDDEN)).toEqual(['seyu']);
  });

  it('flags a Seyu-forbidden CogMap term', () => {
    expect(findForbiddenBrandTerms('Powered by cognitive assessment', SEYU_FORBIDDEN)).toEqual(['cognitive assessment']);
  });

  it('returns an empty array for clean text', () => {
    expect(findForbiddenBrandTerms('Faster onboarding than the incumbent', COGMAP_FORBIDDEN)).toEqual([]);
  });

  it('returns an empty array for non-string input, never throwing', () => {
    expect(() => findForbiddenBrandTerms(undefined as any, COGMAP_FORBIDDEN)).not.toThrow();
    expect(findForbiddenBrandTerms(undefined as any, COGMAP_FORBIDDEN)).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(findForbiddenBrandTerms('We compete with SEYU directly', COGMAP_FORBIDDEN)).toEqual(['seyu']);
  });

  // Issue #147 — DVSC added as a third brand: each brand's forbidden set
  // names both other brands, kept symmetric on purpose. Issue #195 made
  // this a derived property (see tests/lib/brand.test.ts's
  // getForbiddenTermsFor coverage) rather than a hand-maintained list; the
  // two scenarios below just confirm findForbiddenBrandTerms itself still
  // matches correctly against DVSC's derived forbidden set.
  describe('DVSC symmetry (issue #147)', () => {
    it('flags a CogMap or Seyu mention in a DVSC lead', () => {
      expect(findForbiddenBrandTerms('Similar to cogmap', DVSC_FORBIDDEN)).toEqual(['cogmap']);
      expect(findForbiddenBrandTerms('Like seyu for fan engagement', DVSC_FORBIDDEN)).toEqual(['seyu']);
    });

    it('flags a DVSC mention in a CogMap or Seyu lead', () => {
      expect(findForbiddenBrandTerms('We already work with dvsc', COGMAP_FORBIDDEN)).toEqual(['dvsc']);
      expect(findForbiddenBrandTerms('DVSC is a client', SEYU_FORBIDDEN)).toEqual(['dvsc']);
    });
  });
});

describe('normalizeProofPoints', () => {
  it('trims and drops empty/non-string entries', () => {
    expect(normalizeProofPoints(['  Fast onboarding  ', '', '  ', 42 as any, 'Another point'])).toEqual([
      'Fast onboarding',
      'Another point',
    ]);
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeProofPoints(undefined)).toEqual([]);
    expect(normalizeProofPoints('not an array' as any)).toEqual([]);
  });
});

describe('normalizeObjections', () => {
  it('trims fields and drops entries with both objection and response empty', () => {
    const result = normalizeObjections([
      { objection: '  Too expensive  ', response: '  Here is why it pays for itself  ' },
      { objection: '', response: '' },
      { objection: 'Only response', response: '' },
    ]);
    expect(result).toEqual([
      { objection: 'Too expensive', response: 'Here is why it pays for itself' },
      { objection: 'Only response', response: '' },
    ]);
  });

  it('returns an empty array for non-array input, never throwing', () => {
    expect(() => normalizeObjections(null)).not.toThrow();
    expect(normalizeObjections(null)).toEqual([]);
  });
});

describe('validateBattlecardPayload', () => {
  it('requires competitorName and positioningSummary', () => {
    const errors = validateBattlecardPayload({}, 'cogmap', COGMAP_FORBIDDEN);
    expect(errors).toContain('competitorName is required');
    expect(errors).toContain('positioningSummary is required');
  });

  it('rejects positioningSummary containing the opposite brand\'s forbidden terms', () => {
    const errors = validateBattlecardPayload(
      { competitorName: 'Acme', positioningSummary: 'Unlike Seyu, we focus on cognitive metrics.' },
      'cogmap',
      COGMAP_FORBIDDEN
    );
    expect(errors.some((e) => e.includes('positioningSummary') && e.includes('seyu'))).toBe(true);
  });

  it('rejects a proofPoints entry containing forbidden content, reporting its index', () => {
    const errors = validateBattlecardPayload(
      {
        competitorName: 'Acme',
        positioningSummary: 'Clean summary',
        proofPoints: ['Faster setup', 'We are the original cognitive assessment platform'],
      },
      'seyu',
      SEYU_FORBIDDEN
    );
    expect(errors.some((e) => e.includes('proofPoints[1]') && e.includes('cognitive assessment'))).toBe(true);
  });

  it('rejects an objections[].response entry containing forbidden content, but never checks the objection text itself', () => {
    const errors = validateBattlecardPayload(
      {
        competitorName: 'Acme',
        positioningSummary: 'Clean summary',
        objections: [{ objection: 'They mentioned Seyu by name', response: 'We are not Seyu, we do cognitive assessment' }],
      },
      'cogmap',
      COGMAP_FORBIDDEN
    );
    expect(errors.some((e) => e.includes('objections[0].response'))).toBe(true);
    expect(errors.some((e) => e.includes('objections[0].objection'))).toBe(false);
  });

  it('passes with valid, brand-clean content', () => {
    const errors = validateBattlecardPayload(
      {
        competitorName: 'Acme',
        positioningSummary: 'We win on time-to-value and support quality.',
        proofPoints: ['Faster onboarding', '24/7 support'],
        objections: [{ objection: 'Too expensive', response: 'ROI within one quarter for most customers.' }],
      },
      'cogmap',
      COGMAP_FORBIDDEN
    );
    expect(errors).toEqual([]);
  });

  it('allows an empty objections array (not invalid, per issue edge cases)', () => {
    const errors = validateBattlecardPayload(
      { competitorName: 'Acme', positioningSummary: 'Clean summary', objections: [] },
      'cogmap',
      COGMAP_FORBIDDEN
    );
    expect(errors).toEqual([]);
  });
});
