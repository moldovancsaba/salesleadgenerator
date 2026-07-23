import { describe, it, expect } from 'vitest';
import { deriveKanbanColumn, isAutoManagedColumn } from '../../lib/kanban-column';

describe('deriveKanbanColumn', () => {
  it.each([
    [-1, 'DISCOVERED'],
    [0, 'DISCOVERED'],
    [239, 'DISCOVERED'],
    [499, 'DISCOVERED'],
    [500, 'QUALIFIED'],
    [501, 'QUALIFIED'],
    [720, 'QUALIFIED'],
    [1000, 'QUALIFIED'],
  ])('maps ICE score %i to %s', (iceScore, expected) => {
    expect(deriveKanbanColumn(iceScore)).toBe(expected);
  });
});

describe('isAutoManagedColumn', () => {
  it.each([
    ['DISCOVERED', true],
    ['QUALIFIED', true],
    ['ENGAGED', false],
    ['PROPOSAL', false],
    ['WON', false],
    ['LOST', false],
  ])('treats %s as auto-managed: %s', (column, expected) => {
    expect(isAutoManagedColumn(column)).toBe(expected);
  });
});
