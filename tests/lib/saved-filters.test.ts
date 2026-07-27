import { describe, it, expect } from 'vitest';
import { addSavedFilter, removeSavedFilter, isEmptyFilter } from '../../lib/saved-filters';

describe('isEmptyFilter', () => {
  it('treats no region and no industry as empty', () => {
    expect(isEmptyFilter({})).toBe(true);
  });

  it('treats a whitespace-only industry as empty', () => {
    expect(isEmptyFilter({ industry: '   ' })).toBe(true);
  });

  it('treats a set region as non-empty', () => {
    expect(isEmptyFilter({ region: 'US' })).toBe(false);
  });

  it('treats a set industry as non-empty', () => {
    expect(isEmptyFilter({ industry: 'Academy' })).toBe(false);
  });

  it('treats an empty tags array as empty', () => {
    expect(isEmptyFilter({ tags: [] })).toBe(true);
  });

  it('treats a non-empty tags array as non-empty', () => {
    expect(isEmptyFilter({ tags: ['hot-lead'] })).toBe(false);
  });
});

describe('addSavedFilter', () => {
  it('adds a new named filter', () => {
    const result = addSavedFilter([], 'US Academies', { region: 'US', industry: 'Academy' }, 'id-1');
    expect(result).toEqual([{ id: 'id-1', name: 'US Academies', filter: { region: 'US', industry: 'Academy' } }]);
  });

  it('refuses to save an empty filter', () => {
    expect(addSavedFilter([], 'Nothing', {}, 'id-1')).toEqual([]);
  });

  it('refuses to save with a blank name', () => {
    expect(addSavedFilter([], '   ', { region: 'US' }, 'id-1')).toEqual([]);
  });

  it('replaces an existing entry with the same name in place, keeping its id', () => {
    const existing = [{ id: 'id-1', name: 'My Filter', filter: { region: 'US' } }];
    const result = addSavedFilter(existing, 'My Filter', { region: 'CEE' }, 'id-2');
    expect(result).toEqual([{ id: 'id-1', name: 'My Filter', filter: { region: 'CEE' } }]);
  });

  it('caps the list at 20, dropping the oldest first', () => {
    let filters: ReturnType<typeof addSavedFilter> = [];
    for (let i = 0; i < 25; i++) {
      filters = addSavedFilter(filters, `Filter ${i}`, { region: 'US' }, `id-${i}`);
    }
    expect(filters).toHaveLength(20);
    expect(filters[0].name).toBe('Filter 5');
    expect(filters[19].name).toBe('Filter 24');
  });
});

describe('removeSavedFilter', () => {
  it('removes the matching entry by id', () => {
    const existing = [
      { id: 'id-1', name: 'A', filter: { region: 'US' } },
      { id: 'id-2', name: 'B', filter: { region: 'CEE' } },
    ];
    expect(removeSavedFilter(existing, 'id-1')).toEqual([{ id: 'id-2', name: 'B', filter: { region: 'CEE' } }]);
  });

  it('is a no-op for an id that does not exist', () => {
    const existing = [{ id: 'id-1', name: 'A', filter: { region: 'US' } }];
    expect(removeSavedFilter(existing, 'nope')).toEqual(existing);
  });
});
