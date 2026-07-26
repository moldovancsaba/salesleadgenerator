import { describe, it, expect } from 'vitest';
import { enforceQualityCeiling } from '../../lib/quality-registry';

describe('enforceQualityCeiling', () => {
  it('caps the proposed status to the lowest valid upstream status', () => {
    expect(enforceQualityCeiling('VERIFIED', ['DRAFT'])).toBe('DRAFT');
    expect(enforceQualityCeiling('VERIFIED', ['CHECKED'])).toBe('CHECKED');
  });

  it('allows the proposed status through when it does not exceed the ceiling', () => {
    expect(enforceQualityCeiling('CHECKED', ['VERIFIED'])).toBe('CHECKED');
    expect(enforceQualityCeiling('DRAFT', ['DRAFT'])).toBe('DRAFT');
  });

  it('returns the proposed status unchanged when there is no upstream evidence at all', () => {
    expect(enforceQualityCeiling('VERIFIED', [])).toBe('VERIFIED');
  });

  it('falls back to DRAFT for a missing or empty proposedStatus', () => {
    expect(enforceQualityCeiling('', ['DRAFT'])).toBe('DRAFT');
  });

  // Regression coverage for a real corruption bug: an unrecognized status
  // string used to fall through hierarchy.indexOf() as -1, which every real
  // status compared as "higher than," so the ceiling check always fired and
  // wrote the garbage string itself into the qualityStatus enum field.
  it('falls back to DRAFT for an unrecognized proposedStatus rather than writing it through', () => {
    expect(enforceQualityCeiling('not-a-real-status', ['DRAFT'])).toBe('DRAFT');
  });

  it('drops unrecognized upstream entries instead of treating them as the lowest ceiling', () => {
    expect(enforceQualityCeiling('VERIFIED', ['DRAFT', 'garbage-value'])).toBe('DRAFT');
  });

  it('returns the proposed status unchanged when every upstream entry is unrecognized', () => {
    expect(enforceQualityCeiling('VERIFIED', ['garbage', 'also-garbage'])).toBe('VERIFIED');
  });

  it('never returns a string outside DRAFT/CHECKED/VERIFIED for any input', () => {
    const validStatuses = new Set(['DRAFT', 'CHECKED', 'VERIFIED']);
    const inputs: Array<[string, string[]]> = [
      ['', []],
      ['garbage', ['garbage']],
      ['VERIFIED', ['garbage', 'DRAFT', '']],
      ['CHECKED', []],
    ];
    for (const [proposed, upstream] of inputs) {
      expect(validStatuses.has(enforceQualityCeiling(proposed, upstream))).toBe(true);
    }
  });
});
