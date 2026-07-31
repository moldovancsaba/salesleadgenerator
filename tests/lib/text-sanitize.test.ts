import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, decodeHtmlEntitiesInArray } from '../../lib/text-sanitize';

describe('decodeHtmlEntities', () => {
  it('decodes a literal &amp; artifact — the single most frequent real mistake found in the lead-taxonomy classification loop (issue #132)', () => {
    expect(decodeHtmlEntities('Owner &amp; General Manager')).toBe('Owner & General Manager');
  });

  it('decodes &gt;/&lt; found in arrow notation ("7-&gt;9")', () => {
    expect(decodeHtmlEntities('confidence raised 7-&gt;9')).toBe('confidence raised 7->9');
  });

  it('decodes quote/apostrophe/nbsp entities', () => {
    expect(decodeHtmlEntities('&quot;quoted&quot;')).toBe('"quoted"');
    expect(decodeHtmlEntities('it&#39;s')).toBe("it's");
    expect(decodeHtmlEntities('it&apos;s')).toBe("it's");
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes multiple entities in the same string', () => {
    expect(decodeHtmlEntities('Bed &amp; Breakfast &gt; Hotel')).toBe('Bed & Breakfast > Hotel');
  });

  it('leaves plain text with a literal & untouched', () => {
    expect(decodeHtmlEntities('Bed & Breakfast')).toBe('Bed & Breakfast');
  });

  it('leaves strings with no ampersand untouched (fast path)', () => {
    expect(decodeHtmlEntities('nothing to decode here')).toBe('nothing to decode here');
  });

  it('handles empty/non-string input without throwing', () => {
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities(undefined as any)).toBe(undefined);
    expect(decodeHtmlEntities(null as any)).toBe(null);
  });
});

describe('decodeHtmlEntitiesInArray', () => {
  it('decodes every string item in an array', () => {
    expect(decodeHtmlEntitiesInArray(['Bed &amp; Breakfast', 'plain'])).toEqual(['Bed & Breakfast', 'plain']);
  });

  it('passes through non-array input unchanged', () => {
    expect(decodeHtmlEntitiesInArray('not-an-array' as any)).toBe('not-an-array');
  });
});
