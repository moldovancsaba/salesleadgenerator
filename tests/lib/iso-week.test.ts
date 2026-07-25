import { describe, it, expect } from 'vitest';
import { isoWeekKey } from '../../lib/iso-week';

describe('isoWeekKey', () => {
  it('returns the correct ISO week for a mid-week date', () => {
    // 2026-07-25 is a Saturday in ISO week 30 of 2026.
    expect(isoWeekKey(new Date('2026-07-25T00:00:00.000Z'))).toBe('2026-W30');
  });

  it('is UTC-anchored — a date near midnight UTC on a week boundary resolves to the same week key regardless of local time', () => {
    // 2026-07-27 (Monday) 00:00:00 UTC starts ISO week 31.
    expect(isoWeekKey(new Date('2026-07-27T00:00:00.000Z'))).toBe('2026-W31');
    // One millisecond before that, still week 30.
    expect(isoWeekKey(new Date('2026-07-26T23:59:59.999Z'))).toBe('2026-W30');
  });

  it('assigns the last days of December to week 1 of the following year when ISO-appropriate', () => {
    // 2025-12-29 (Monday) is ISO week 1 of 2026 (the Thursday of that week, Jan 1 2026, falls in 2026).
    expect(isoWeekKey(new Date('2025-12-29T00:00:00.000Z'))).toBe('2026-W01');
  });

  it('assigns early January dates to the final week of the prior ISO year when ISO-appropriate', () => {
    // 2027-01-01 (Friday) belongs to ISO week 53 of 2026 (its Thursday, Dec 31 2026, falls in 2026).
    expect(isoWeekKey(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-W53');
  });

  it('produces a stable, sortable key across the same week', () => {
    const monday = isoWeekKey(new Date('2026-03-02T00:00:00.000Z'));
    const sunday = isoWeekKey(new Date('2026-03-08T23:59:59.999Z'));
    expect(monday).toBe(sunday);
  });
});
