import { describe, it, expect } from 'vitest';
import { sanitizeChecklistItem, sanitizeChecklist, checklistProgress } from '../../lib/checklist';

const NOW = new Date('2026-07-27T00:00:00.000Z');

describe('sanitizeChecklistItem', () => {
  it('returns null for missing/blank text', () => {
    expect(sanitizeChecklistItem({}, null, NOW)).toBeNull();
    expect(sanitizeChecklistItem({ text: '   ' }, null, NOW)).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(sanitizeChecklistItem(null as any, null, NOW)).toBeNull();
  });

  it('trims text and defaults done to false', () => {
    const item = sanitizeChecklistItem({ text: '  Call back  ' }, null, NOW);
    expect(item?.text).toBe('Call back');
    expect(item?.done).toBe(false);
    expect(item?.completedAt).toBeUndefined();
  });

  it('stamps completedAt when done is true', () => {
    const item = sanitizeChecklistItem({ text: 'Send proposal', done: true }, null, NOW);
    expect(item?.done).toBe(true);
    expect(item?.completedAt).toBe(NOW.toISOString());
  });

  it('preserves the original completedAt when an already-done item is re-saved done', () => {
    const original = sanitizeChecklistItem({ text: 'Follow up', done: true }, null, NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    const resaved = sanitizeChecklistItem({ text: 'Follow up (edited)', done: true }, original, later);
    expect(resaved?.completedAt).toBe(original?.completedAt);
  });

  it('re-stamps completedAt when re-checked after being unchecked', () => {
    const done = sanitizeChecklistItem({ text: 'Task', done: true }, null, NOW);
    const later1 = new Date(NOW.getTime() + 86_400_000);
    const unchecked = sanitizeChecklistItem({ text: 'Task', done: false }, done, later1);
    expect(unchecked?.completedAt).toBeUndefined();
    const later2 = new Date(NOW.getTime() + 2 * 86_400_000);
    const rechecked = sanitizeChecklistItem({ text: 'Task', done: true }, unchecked, later2);
    expect(rechecked?.completedAt).toBe(later2.toISOString());
  });

  it('preserves createdAt across an edit', () => {
    const original = sanitizeChecklistItem({ text: 'Task' }, null, NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    const edited = sanitizeChecklistItem({ text: 'Task (edited)' }, original, later);
    expect(edited?.createdAt).toBe(original?.createdAt);
  });
});

describe('sanitizeChecklist', () => {
  it('returns [] for a non-array input', () => {
    expect(sanitizeChecklist(null, [], NOW)).toEqual([]);
  });

  it('drops blank rows while keeping valid ones', () => {
    const result = sanitizeChecklist([{ text: 'A' }, { text: '' }, { text: 'B' }], [], NOW);
    expect(result).toHaveLength(2);
  });
});

describe('checklistProgress', () => {
  it('returns 0/0 for an empty/missing array', () => {
    expect(checklistProgress(undefined)).toEqual({ done: 0, total: 0 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('counts done vs. total correctly', () => {
    const items = sanitizeChecklist([{ text: 'A', done: true }, { text: 'B', done: false }, { text: 'C', done: true }], [], NOW);
    expect(checklistProgress(items)).toEqual({ done: 2, total: 3 });
  });
});
