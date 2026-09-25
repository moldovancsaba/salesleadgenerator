import { describe, it, expect } from 'vitest';
import {
  computeAvailableSlots, isSlotStillAvailable, isRateLimited, isValidAvailabilityWindow,
  DEFAULT_AVAILABILITY_WINDOW, type AvailabilityWindow,
} from '../../lib/scheduling';

const WINDOW: AvailabilityWindow = {
  weekdays: [1, 2, 3, 4, 5], // Mon-Fri
  startMinuteOfDay: 9 * 60,
  endMinuteOfDay: 11 * 60,
  slotMinutes: 60,
  bufferMinutes: 0,
};

describe('computeAvailableSlots (issue 207)', () => {
  it('produces slots only on configured weekdays, within the configured hours, in UTC', () => {
    // 2026-01-05 is a Monday.
    const slots = computeAvailableSlots({
      rangeStart: '2026-01-05T00:00:00.000Z',
      rangeEnd: '2026-01-06T00:00:00.000Z',
      timeZone: 'UTC',
      window: WINDOW,
      busy: [],
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(slots).toEqual([
      { start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T10:00:00.000Z' },
      { start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T11:00:00.000Z' },
    ]);
  });

  it('excludes a weekend day even though it falls inside the range', () => {
    // 2026-01-03/04 is Sat/Sun.
    const slots = computeAvailableSlots({
      rangeStart: '2026-01-03T00:00:00.000Z',
      rangeEnd: '2026-01-05T00:00:00.000Z',
      timeZone: 'UTC',
      window: WINDOW,
      busy: [],
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(slots).toEqual([]);
  });

  it('excludes a slot that overlaps a busy interval', () => {
    const slots = computeAvailableSlots({
      rangeStart: '2026-01-05T00:00:00.000Z',
      rangeEnd: '2026-01-06T00:00:00.000Z',
      timeZone: 'UTC',
      window: WINDOW,
      busy: [{ start: '2026-01-05T09:30:00.000Z', end: '2026-01-05T09:45:00.000Z' }],
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(slots).toEqual([{ start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T11:00:00.000Z' }]);
  });

  it('excludes a slot within the buffer of a busy interval, not just an exact overlap', () => {
    const buffered = { ...WINDOW, bufferMinutes: 30 };
    const slots = computeAvailableSlots({
      rangeStart: '2026-01-05T00:00:00.000Z',
      rangeEnd: '2026-01-06T00:00:00.000Z',
      timeZone: 'UTC',
      window: buffered,
      // Busy 10:00-11:00 — the 9:00 slot ends at 10:00, and with a 30min
      // buffer its expanded window (9:00-10:30) overlaps the busy block.
      busy: [{ start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T11:00:00.000Z' }],
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(slots).toEqual([]);
  });

  it('never offers a slot starting sooner than the minimum lead time', () => {
    const slots = computeAvailableSlots({
      rangeStart: '2026-01-05T00:00:00.000Z',
      rangeEnd: '2026-01-06T00:00:00.000Z',
      timeZone: 'UTC',
      window: WINDOW,
      busy: [],
      now: '2026-01-05T08:15:00.000Z', // 1hr lead time -> minStart 09:15, excludes only the 9:00 slot
    });
    expect(slots).toEqual([{ start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T11:00:00.000Z' }]);
  });

  it('is DST-correct: an availability window defined in local wall-clock hours holds across a DST transition', () => {
    // America/New_York DST begins 2026-03-08 at 2am local. The 9am-11am
    // local window should be 14:00-16:00 UTC before the transition week
    // and 13:00-15:00 UTC after it, not a fixed UTC offset.
    const beforeDst = computeAvailableSlots({
      rangeStart: '2026-03-01T00:00:00.000Z',
      rangeEnd: '2026-03-02T00:00:00.000Z', // Sunday, not a configured weekday — use Monday instead
      timeZone: 'America/New_York',
      window: { ...WINDOW, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      busy: [],
      now: '2026-02-01T00:00:00.000Z',
    });
    const afterDst = computeAvailableSlots({
      rangeStart: '2026-03-15T00:00:00.000Z',
      rangeEnd: '2026-03-16T00:00:00.000Z',
      timeZone: 'America/New_York',
      window: { ...WINDOW, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      busy: [],
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(beforeDst[0].start).toBe('2026-03-01T14:00:00.000Z'); // EST, UTC-5
    expect(afterDst[0].start).toBe('2026-03-15T13:00:00.000Z'); // EDT, UTC-4
  });
});

describe('isSlotStillAvailable (issue 207)', () => {
  it('is true when the exact slot is present in the fresh list', () => {
    const slot = { start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T10:00:00.000Z' };
    expect(isSlotStillAvailable(slot, [slot])).toBe(true);
  });

  it('is false once the slot has been taken (no longer in the fresh list)', () => {
    const slot = { start: '2026-01-05T09:00:00.000Z', end: '2026-01-05T10:00:00.000Z' };
    expect(isSlotStillAvailable(slot, [])).toBe(false);
  });
});

describe('isRateLimited (issue 207)', () => {
  it('is false below the limit, true at or above it', () => {
    expect(isRateLimited(5, 20)).toBe(false);
    expect(isRateLimited(20, 20)).toBe(true);
    expect(isRateLimited(21, 20)).toBe(true);
  });
});

describe('isValidAvailabilityWindow (issue 207)', () => {
  it('accepts the real default window', () => {
    expect(isValidAvailabilityWindow(DEFAULT_AVAILABILITY_WINDOW)).toBe(true);
  });

  it('rejects an end time not after the start time', () => {
    expect(isValidAvailabilityWindow({ ...DEFAULT_AVAILABILITY_WINDOW, startMinuteOfDay: 600, endMinuteOfDay: 600 })).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(isValidAvailabilityWindow(null)).toBe(false);
    expect(isValidAvailabilityWindow('window')).toBe(false);
  });

  it('rejects an out-of-range weekday', () => {
    expect(isValidAvailabilityWindow({ ...DEFAULT_AVAILABILITY_WINDOW, weekdays: [7] })).toBe(false);
  });
});
