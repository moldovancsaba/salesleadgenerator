import { describe, it, expect } from 'vitest';
import {
  parseTodayWindow,
  computeSnoozeDate,
  computeOverdueDays,
} from '../../lib/today';

describe('lib/today', () => {
  describe('parseTodayWindow', () => {
    it('computes UTC day boundaries correctly by default', () => {
      const fixedNow = new Date('2026-10-13T14:30:00.000Z');
      const window = parseTodayWindow(undefined, fixedNow);

      expect(window.timezone).toBe('UTC');
      expect(window.dateStr).toBe('2026-10-13');
      expect(window.dayStart.toISOString()).toBe('2026-10-13T00:00:00.000Z');
      expect(window.dayEnd.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    });

    it('computes localized boundaries for valid IANA timezones', () => {
      // 2026-10-13 01:30 UTC is still 2026-10-12 in New York (EDT, UTC-4)
      const fixedNow = new Date('2026-10-13T01:30:00.000Z');
      const nyWindow = parseTodayWindow('America/New_York', fixedNow);

      expect(nyWindow.timezone).toBe('America/New_York');
      expect(nyWindow.dateStr).toBe('2026-10-12');
      expect(nyWindow.dayStart.toISOString()).toBe('2026-10-12T00:00:00.000Z');
      expect(nyWindow.dayEnd.toISOString()).toBe('2026-10-13T00:00:00.000Z');

      // But in Tokyo (UTC+9), 2026-10-13 01:30 UTC is 2026-10-13 10:30
      const tokyoWindow = parseTodayWindow('Asia/Tokyo', fixedNow);
      expect(tokyoWindow.timezone).toBe('Asia/Tokyo');
      expect(tokyoWindow.dateStr).toBe('2026-10-13');
    });

    it('gracefully falls back to UTC if timezone is invalid or unrecognized', () => {
      const fixedNow = new Date('2026-10-13T10:00:00.000Z');
      const window = parseTodayWindow('Invalid/Not_A_Timezone_123', fixedNow);

      expect(window.timezone).toBe('UTC');
      expect(window.dateStr).toBe('2026-10-13');
      expect(window.dayStart.toISOString()).toBe('2026-10-13T00:00:00.000Z');
      expect(window.dayEnd.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    });
  });

  describe('computeSnoozeDate', () => {
    const base = new Date('2026-10-13T10:00:00.000Z');

    it('snoozes by 1d / tomorrow', () => {
      const res1 = computeSnoozeDate('1d', base);
      expect(res1.toISOString()).toBe('2026-10-14T10:00:00.000Z');

      const res2 = computeSnoozeDate('tomorrow', base);
      expect(res2.toISOString()).toBe('2026-10-14T10:00:00.000Z');
    });

    it('snoozes by 3d', () => {
      const res = computeSnoozeDate('3d', base);
      expect(res.toISOString()).toBe('2026-10-16T10:00:00.000Z');
    });

    it('snoozes by 1w / 7d', () => {
      const res1 = computeSnoozeDate('1w', base);
      expect(res1.toISOString()).toBe('2026-10-20T10:00:00.000Z');

      const res2 = computeSnoozeDate('7d', base);
      expect(res2.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    });

    it('snoozes by 2w / 14d', () => {
      const res = computeSnoozeDate('2w', base);
      expect(res.toISOString()).toBe('2026-10-27T10:00:00.000Z');
    });

    it('handles custom valid future ISO date string', () => {
      const futureIso = '2026-11-01T15:00:00.000Z';
      const res = computeSnoozeDate(futureIso, base);
      expect(res.toISOString()).toBe(futureIso);
    });

    it('defaults to 1 day for unrecognized or past duration input', () => {
      const resInvalid = computeSnoozeDate('invalid-duration', base);
      expect(resInvalid.toISOString()).toBe('2026-10-14T10:00:00.000Z');

      const pastIso = '2026-10-01T00:00:00.000Z';
      const resPast = computeSnoozeDate(pastIso, base);
      expect(resPast.toISOString()).toBe('2026-10-14T10:00:00.000Z');
    });
  });

  describe('computeOverdueDays', () => {
    const now = new Date('2026-10-13T12:00:00.000Z');

    it('returns 0 for future dates', () => {
      expect(computeOverdueDays('2026-10-14T12:00:00.000Z', now)).toBe(0);
      expect(computeOverdueDays('2026-10-20T00:00:00.000Z', now)).toBe(0);
    });

    it('returns 0 for same-day timestamps', () => {
      expect(computeOverdueDays('2026-10-13T12:00:00.000Z', now)).toBe(0);
      expect(computeOverdueDays('2026-10-13T08:00:00.000Z', now)).toBe(0);
    });

    it('returns accurate positive count for overdue dates', () => {
      expect(computeOverdueDays('2026-10-12T10:00:00.000Z', now)).toBe(1);
      expect(computeOverdueDays('2026-10-08T12:00:00.000Z', now)).toBe(5);
      expect(computeOverdueDays('2026-09-13T12:00:00.000Z', now)).toBe(30);
    });

    it('returns 0 for invalid date strings', () => {
      expect(computeOverdueDays('not-a-date', now)).toBe(0);
    });
  });
});
