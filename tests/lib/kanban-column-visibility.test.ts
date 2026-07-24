import { describe, it, expect } from 'vitest';
import { toggleColumnVisibility } from '../../lib/kanban-column-visibility';

describe('toggleColumnVisibility', () => {
  it('hides a column that is currently visible', () => {
    const result = toggleColumnVisibility(new Set<string>(), 'QUALIFIED', 6);
    expect(result.has('QUALIFIED')).toBe(true);
  });

  it('shows a column that is currently hidden', () => {
    const hidden = new Set(['QUALIFIED']);
    const result = toggleColumnVisibility(hidden, 'QUALIFIED', 6);
    expect(result.has('QUALIFIED')).toBe(false);
  });

  it('never hides the last remaining visible column', () => {
    const hidden = new Set(['DISCOVERED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']);
    const result = toggleColumnVisibility(hidden, 'QUALIFIED', 6);
    expect(result.has('QUALIFIED')).toBe(false);
    expect(result).toEqual(hidden);
  });

  it('does not mutate the input set', () => {
    const hidden = new Set<string>();
    toggleColumnVisibility(hidden, 'QUALIFIED', 6);
    expect(hidden.size).toBe(0);
  });
});
