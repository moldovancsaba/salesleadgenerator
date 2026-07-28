import { describe, it, expect } from 'vitest';
import { generateClassificationTags, buildMergeKey } from '../../lib/lead-classification';

describe('generateClassificationTags', () => {
  it('generates a tag per set field, in the documented namespace order', () => {
    const tags = generateClassificationTags({
      sportCode: 'football',
      orgTypeCode: 'club',
      businessUnitCode: 'youth-academy',
      genderCode: 'men',
      demographicCodes: ['youth', 'adult'],
      country: 'de',
      cityName: 'München',
    });
    expect(tags).toEqual([
      '#sport:football',
      '#type:club',
      '#unit:youth-academy',
      '#gender:men',
      '#demo:youth',
      '#demo:adult',
      '#country:DE',
      '#city:munchen',
    ]);
  });

  it('omits a tag entirely for any field that is not set, rather than a placeholder', () => {
    const tags = generateClassificationTags({ sportCode: 'football' });
    expect(tags).toEqual(['#sport:football']);
  });

  it('returns an empty array when no classification fields are set', () => {
    expect(generateClassificationTags({})).toEqual([]);
  });

  it('uppercases the country code and skips a blank city slug', () => {
    const tags = generateClassificationTags({ country: 'us', cityName: '   ' });
    expect(tags).toEqual(['#country:US']);
  });
});

describe('buildMergeKey', () => {
  it('joins all seven components in order with "unknown" for missing ones, never omitting a segment', () => {
    const key = buildMergeKey({ sportCode: 'football', country: 'DE', cityName: 'Munich' });
    expect(key).toBe('unknown|football|unknown|unknown|unknown|DE|munich');
  });

  it('slugifies the parent org name and city name', () => {
    const key = buildMergeKey({ parentOrgName: 'FC Bayern München', cityName: 'São Paulo' });
    expect(key).toContain('fc-bayern-munchen');
    expect(key).toContain('sao-paulo');
  });

  it('produces an all-"unknown" key when no fields are set', () => {
    expect(buildMergeKey({})).toBe('unknown|unknown|unknown|unknown|unknown|unknown|unknown');
  });

  it('uppercases the country code consistently with generateClassificationTags', () => {
    expect(buildMergeKey({ country: 'gb' })).toContain('|GB|');
  });
});
