import { describe, it, expect } from 'vitest';
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../app/lib/battlecards/validate-battlecard';
import { findForbiddenBrandTerms, FORBIDDEN_BRAND_TERMS } from '../../lib/validate-lead';

describe('findForbiddenBrandTerms', () => {
  it('flags a CogMap-forbidden Seyu term', () => {
    expect(findForbiddenBrandTerms('We are basically Seyu for academies', 'cogmap')).toEqual(['seyu']);
  });

  it('flags a Seyu-forbidden CogMap term', () => {
    expect(findForbiddenBrandTerms('Powered by cognitive assessment', 'seyu')).toEqual(['cognitive assessment']);
  });

  it('returns an empty array for clean text', () => {
    expect(findForbiddenBrandTerms('Faster onboarding than the incumbent', 'cogmap')).toEqual([]);
  });

  it('returns an empty array for non-string input, never throwing', () => {
    expect(() => findForbiddenBrandTerms(undefined as any, 'cogmap')).not.toThrow();
    expect(findForbiddenBrandTerms(undefined as any, 'cogmap')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(findForbiddenBrandTerms('We compete with SEYU directly', 'cogmap')).toEqual(['seyu']);
  });

  // Issue #147 — DVSC added as a third brand: each brand's list now names
  // both other brands, kept symmetric on purpose.
  describe('DVSC symmetry (issue #147)', () => {
    it('flags a CogMap or Seyu mention in a DVSC lead', () => {
      expect(findForbiddenBrandTerms('Similar to cogmap', 'dvsc')).toEqual(['cogmap']);
      expect(findForbiddenBrandTerms('Like seyu for fan engagement', 'dvsc')).toEqual(['seyu']);
    });

    it('flags a DVSC mention in a CogMap or Seyu lead', () => {
      expect(findForbiddenBrandTerms('We already work with dvsc', 'cogmap')).toEqual(['dvsc']);
      expect(findForbiddenBrandTerms('DVSC is a client', 'seyu')).toEqual(['dvsc']);
    });

    it('every brand names both other brands in its own forbidden list — fully symmetric across all 3', () => {
      const brands = Object.keys(FORBIDDEN_BRAND_TERMS);
      expect(brands.sort()).toEqual(['COGMAP', 'DVSC', 'SEYU']);
      for (const brand of brands) {
        const others = brands.filter((b) => b !== brand).map((b) => b.toLowerCase());
        for (const other of others) {
          expect(FORBIDDEN_BRAND_TERMS[brand]).toContain(other);
        }
      }
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
    const errors = validateBattlecardPayload({}, 'cogmap');
    expect(errors).toContain('competitorName is required');
    expect(errors).toContain('positioningSummary is required');
  });

  it('rejects positioningSummary containing the opposite brand\'s forbidden terms', () => {
    const errors = validateBattlecardPayload(
      { competitorName: 'Acme', positioningSummary: 'Unlike Seyu, we focus on cognitive metrics.' },
      'cogmap'
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
      'seyu'
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
      'cogmap'
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
      'cogmap'
    );
    expect(errors).toEqual([]);
  });

  it('allows an empty objections array (not invalid, per issue edge cases)', () => {
    const errors = validateBattlecardPayload(
      { competitorName: 'Acme', positioningSummary: 'Clean summary', objections: [] },
      'cogmap'
    );
    expect(errors).toEqual([]);
  });
});
