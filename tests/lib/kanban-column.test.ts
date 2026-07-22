import { describe, it, expect } from 'vitest';
import { deriveKanbanColumn } from '../../lib/kanban-column';

describe('deriveKanbanColumn', () => {
  it.each([
    [-1, 'DISCOVERED'],
    [0, 'DISCOVERED'],
    [239, 'DISCOVERED'],
    [240, 'DISCOVERED'],
    [241, 'DISCOVERED'],
    [479, 'DISCOVERED'],
    [480, 'QUALIFIED'],
    [481, 'QUALIFIED'],
    [719, 'QUALIFIED'],
    [720, 'ENGAGED'],
    [721, 'ENGAGED'],
    [1000, 'ENGAGED'],
  ])('maps ICE score %i to %s', (iceScore, expected) => {
    expect(deriveKanbanColumn(iceScore)).toBe(expected);
  });
});
