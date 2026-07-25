import { describe, it, expect } from 'vitest';
import { validateBattlecardPayload, normalizeProofPoints, normalizeObjections } from '../../app/lib/battlecards/validate-battlecard';
import { findForbiddenBrandTerms } from '../../lib/validate-lead';

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
