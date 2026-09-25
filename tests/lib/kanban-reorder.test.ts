import { describe, it, expect } from 'vitest';
import {
  computeReorderSortOrder, NEEDS_RESEQUENCE, resolveReorderNeighbors, decideMoveItemAction,
} from '../../lib/kanban-reorder';

describe('computeReorderSortOrder (issue 208)', () => {
  it('returns Date.now()-scale value when the column holds only this one lead', () => {
    const before = Date.now();
    const result = computeReorderSortOrder(null, null);
    const after = Date.now();
    expect(typeof result).toBe('number');
    expect(result as number).toBeGreaterThanOrEqual(before);
    expect(result as number).toBeLessThanOrEqual(after);
  });

  it('dropped at the very top: sorts above the current top item', () => {
    const result = computeReorderSortOrder(null, 1000);
    expect(result).toBe(1_001_000);
  });

  it('dropped at the very bottom: sorts below the current bottom item', () => {
    const result = computeReorderSortOrder(1000, null);
    expect(result).toBe(-999_000);
  });

  it('dropped in the middle: returns the true midpoint', () => {
    const result = computeReorderSortOrder(2000, 1000);
    expect(result).toBe(1500);
  });

  it('does not signal NEEDS_RESEQUENCE for adjacent integers — there is still real room to bisect', () => {
    const result = computeReorderSortOrder(1001, 1000);
    expect(result).toBe(1000.5);
  });

  it('signals NEEDS_RESEQUENCE once neighbors are within the float64 precision floor', () => {
    const prev = 1000;
    const next = 1000 + 1e-10;
    const result = computeReorderSortOrder(prev, next);
    expect(result).toBe(NEEDS_RESEQUENCE);
  });

  it('signals NEEDS_RESEQUENCE when the midpoint collapses onto a neighbor (repeated bisection)', () => {
    // Simulate the degenerate case directly: two neighbors close enough that
    // floating point addition/division collapses the midpoint onto one side.
    const prev = 1;
    const next = 0;
    let a = prev;
    let b = next;
    let result: number | typeof NEEDS_RESEQUENCE = NEEDS_RESEQUENCE;
    for (let i = 0; i < 100; i++) {
      result = computeReorderSortOrder(a, b);
      if (result === NEEDS_RESEQUENCE) break;
      b = result;
    }
    expect(result).toBe(NEEDS_RESEQUENCE);
  });
});

describe('resolveReorderNeighbors (issue 208)', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('dropping at index 0 has no prev and the former-first item as next', () => {
    expect(resolveReorderNeighbors(ids, 'c', 0)).toEqual({ prevLeadId: null, nextLeadId: 'a' });
  });

  it('dropping at the end has no next and the former-last item as prev', () => {
    expect(resolveReorderNeighbors(ids, 'a', 3)).toEqual({ prevLeadId: 'd', nextLeadId: null });
  });

  it('dropping in the middle resolves both neighbors', () => {
    expect(resolveReorderNeighbors(ids, 'd', 1)).toEqual({ prevLeadId: 'a', nextLeadId: 'b' });
  });

  it('the dragged item itself is excluded before resolving neighbors', () => {
    // 'b' dragged to index 2 among [a, c, d] (b removed) -> between c and d.
    expect(resolveReorderNeighbors(ids, 'b', 2)).toEqual({ prevLeadId: 'c', nextLeadId: 'd' });
  });

  it('a single-item column resolves both neighbors to null', () => {
    expect(resolveReorderNeighbors(['only'], 'only', 0)).toEqual({ prevLeadId: null, nextLeadId: null });
  });

  it('clamps an out-of-range toIndex to the end of the list', () => {
    expect(resolveReorderNeighbors(ids, 'a', 99)).toEqual({ prevLeadId: 'd', nextLeadId: null });
  });

  it('clamps a negative toIndex to the start of the list', () => {
    expect(resolveReorderNeighbors(ids, 'd', -5)).toEqual({ prevLeadId: null, nextLeadId: 'a' });
  });
});

describe('decideMoveItemAction (issue 208)', () => {
  it('is cross-column whenever the source and target columns differ', () => {
    expect(decideMoveItemAction('DISCOVERED', 'ENGAGED', false)).toBe('cross-column');
    expect(decideMoveItemAction('ENGAGED', 'QUALIFIED', true)).toBe('cross-column');
  });

  it('rejects a same-column drag on an auto-managed target column', () => {
    expect(decideMoveItemAction('QUALIFIED', 'QUALIFIED', true)).toBe('auto-managed-reject');
  });

  it('is a real reorder for a same-column drag on a manually-controlled column', () => {
    expect(decideMoveItemAction('ENGAGED', 'ENGAGED', false)).toBe('reorder');
  });
});
