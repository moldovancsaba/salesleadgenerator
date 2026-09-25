import { describe, it, expect } from 'vitest';
import { fieldsWrittenBy, inverseCounterDelta, pick, deepEqual } from '../../lib/bulk-undo';

describe('fieldsWrittenBy', () => {
  it('returns the fixed field set for ACCEPT/DECLINE/PIN/ASSIGN', () => {
    expect(fieldsWrittenBy('ACCEPT')).toEqual(['status']);
    expect(fieldsWrittenBy('DECLINE')).toEqual(['status', 'kanbanColumn', 'declineReason']);
    expect(fieldsWrittenBy('PIN')).toEqual(['kanbanColumn']);
    expect(fieldsWrittenBy('ASSIGN')).toEqual(['assignedTo', 'assignedToEmail']);
  });

  it('never includes activeCadence for DECLINE — undo does not attempt to resume a cancelled cadence', () => {
    expect(fieldsWrittenBy('DECLINE')).not.toContain('activeCadence');
  });

  it('returns exactly the one named field for FIELD_EDIT, or [] when no field is given', () => {
    expect(fieldsWrittenBy('FIELD_EDIT', 'tags')).toEqual(['tags']);
    expect(fieldsWrittenBy('FIELD_EDIT', 'qualityStatus')).toEqual(['qualityStatus']);
    expect(fieldsWrittenBy('FIELD_EDIT')).toEqual([]);
  });
});

describe('inverseCounterDelta', () => {
  it('reverses ACCEPT\'s +1/+1 counters to -1/-1', () => {
    expect(inverseCounterDelta('ACCEPT')).toEqual({ acceptanceCount: -1, feedbackScore: -1 });
  });

  it('reverses DECLINE\'s +1/-1 counters to -1/+1', () => {
    expect(inverseCounterDelta('DECLINE')).toEqual({ declineCount: -1, feedbackScore: 1 });
  });

  it('has no counter side effect to reverse for PIN, FIELD_EDIT, or ASSIGN', () => {
    expect(inverseCounterDelta('PIN')).toEqual({});
    expect(inverseCounterDelta('FIELD_EDIT')).toEqual({});
    expect(inverseCounterDelta('ASSIGN')).toEqual({});
  });
});

describe('pick', () => {
  it('picks only the named keys', () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('normalizes an undefined/absent source field to null rather than dropping it', () => {
    expect(pick({ a: 1 }, ['a', 'b'])).toEqual({ a: 1, b: null });
  });

  it('preserves an explicit null as null', () => {
    expect(pick({ a: null }, ['a'])).toEqual({ a: null });
  });
});

describe('deepEqual', () => {
  it('is true for identical primitives and false for different ones', () => {
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('compares string arrays by value and order, not by reference', () => {
    expect(deepEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(deepEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(deepEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it('compares plain objects by key/value, regardless of key order', () => {
    expect(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(deepEqual({ x: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(deepEqual({ x: 1 }, { x: 2 })).toBe(false);
  });
});
