import { describe, it, expect } from 'vitest';
import { buildTaggedContentFilter, normalizeTags } from '../../app/lib/search/tagged-content-filter';

describe('normalizeTags', () => {
  it('trims whitespace and drops empty entries', () => {
    expect(normalizeTags([' Federation ', '', '  '])).toEqual(['Federation']);
  });

  it('dedupes case-insensitively, preserving first-seen casing', () => {
    expect(normalizeTags(['Academy', 'academy', 'ACADEMY'])).toEqual(['Academy']);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('ignores non-string entries', () => {
    expect(normalizeTags(['A', 123 as any, null as any, 'B'])).toEqual(['A', 'B']);
  });
});

describe('buildTaggedContentFilter', () => {
  it('returns only tenant/brand scope when q and tags are both absent', () => {
    const filter = buildTaggedContentFilter({ tenantId: 'default', brand: 'cogmap', textFields: ['name', 'body'] });
    expect(filter).toEqual({ tenantId: 'default', brand: 'cogmap' });
  });

  it('adds a $or regex clause across textFields when q is present', () => {
    const filter = buildTaggedContentFilter({ q: 'academy', textFields: ['name', 'body'] });
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toEqual([
      { name: { $regex: 'academy', $options: 'i' } },
      { body: { $regex: 'academy', $options: 'i' } },
    ]);
  });

  it('adds a tags $in clause when tags is present', () => {
    const filter = buildTaggedContentFilter({ tags: ['Federation'], textFields: [] });
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].tags.$in).toHaveLength(1);
    expect(filter.$and[0].tags.$in[0]).toBeInstanceOf(RegExp);
    expect('federation').toMatch(filter.$and[0].tags.$in[0]);
    expect('federationX').not.toMatch(filter.$and[0].tags.$in[0]);
  });

  it('combines q and tags into two separate $and clauses', () => {
    const filter = buildTaggedContentFilter({ q: 'intro', tags: ['Club'], textFields: ['name'] });
    expect(filter.$and).toHaveLength(2);
  });

  it('omits the $and key entirely when neither q nor tags is supplied', () => {
    const filter = buildTaggedContentFilter({ textFields: ['name'] });
    expect(filter.$and).toBeUndefined();
  });

  it('escapes regex-special characters in a tag', () => {
    const filter = buildTaggedContentFilter({ tags: ['C++'], textFields: [] });
    const re = filter.$and[0].tags.$in[0];
    expect('c++').toMatch(re);
    expect('c').not.toMatch(re);
  });
});
