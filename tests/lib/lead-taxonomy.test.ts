import { describe, it, expect } from 'vitest';
import {
  resolveSportAlias, slugifyForTag,
  isValidSportCode, isValidOrgTypeCode, isValidBusinessUnitCode,
  isValidGenderCode, isValidDemographicCode, isValidCompetitionLevelCode,
  isValidRelationshipCode,
} from '../../lib/lead-taxonomy';

describe('resolveSportAlias', () => {
  it('resolves known free-text aliases to their canonical sport code', () => {
    expect(resolveSportAlias('Soccer')).toBe('football');
    expect(resolveSportAlias('Football (Soccer)')).toBe('football');
    expect(resolveSportAlias('  ICE HOCKEY  ')).toBe('ice-hockey');
    expect(resolveSportAlias('Track & Field')).toBe('athletics');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveSportAlias('  basketball ')).toBe('basketball');
  });

  it('passes through an already-canonical code unchanged', () => {
    expect(resolveSportAlias('handball')).toBe('handball');
  });

  it('returns null (never guesses) for unmapped free text', () => {
    expect(resolveSportAlias('Underwater Basket Weaving')).toBeNull();
  });

  it('returns null for empty/undefined/null input', () => {
    expect(resolveSportAlias('')).toBeNull();
    expect(resolveSportAlias(undefined)).toBeNull();
    expect(resolveSportAlias(null)).toBeNull();
  });
});

describe('slugifyForTag', () => {
  it('lowercases, hyphenates, and strips diacritics', () => {
    expect(slugifyForTag('München')).toBe('munchen');
    expect(slugifyForTag('São Paulo')).toBe('sao-paulo');
    expect(slugifyForTag('New York City')).toBe('new-york-city');
  });

  it('strips leading/trailing hyphens produced by punctuation', () => {
    expect(slugifyForTag('  -Acme!! ')).toBe('acme');
  });

  it('returns an empty string for empty/undefined/null input', () => {
    expect(slugifyForTag('')).toBe('');
    expect(slugifyForTag(undefined)).toBe('');
    expect(slugifyForTag(null)).toBe('');
  });
});

describe('controlled-vocabulary validators', () => {
  it('accept a real code from their own vocabulary', () => {
    expect(isValidSportCode('football')).toBe(true);
    expect(isValidOrgTypeCode('club')).toBe(true);
    expect(isValidBusinessUnitCode('youth-academy')).toBe(true);
    expect(isValidGenderCode('mixed')).toBe(true);
    expect(isValidDemographicCode('youth')).toBe(true);
    expect(isValidCompetitionLevelCode('professional')).toBe(true);
    expect(isValidRelationshipCode('licensed')).toBe(true);
  });

  it('reject a value from a different vocabulary or free text', () => {
    expect(isValidSportCode('club')).toBe(false);
    expect(isValidOrgTypeCode('football')).toBe(false);
    expect(isValidGenderCode('Male')).toBe(false); // wrong casing, not a controlled value
  });

  it('reject non-string values', () => {
    expect(isValidSportCode(undefined)).toBe(false);
    expect(isValidSportCode(null)).toBe(false);
    expect(isValidSportCode(42)).toBe(false);
  });
});
