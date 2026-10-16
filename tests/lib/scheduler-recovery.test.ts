import { describe, it, expect } from 'vitest';
import {
  downtimeExceeded,
  stricterGap,
  nextScheduleSlot,
  SlotBook,
  SCHEDULER_RECOVERY_THRESHOLD_MS,
  RECOVERY_MAX_SENDS_PER_HOUR,
  RECOVERY_MIN_GAP_SECONDS,
  DEFAULT_DAILY_CAP,
  type RecoveryPolicy,
} from '../../lib/scheduler-recovery';

describe('scheduler-recovery (Critical Invariants 4 & 5)', () => {
  describe('downtimeExceeded', () => {
    it('returns false for fresh install / first run (null or undefined heartbeat)', () => {
      const now = new Date('2026-10-16T12:00:00Z');
      expect(downtimeExceeded(null, now)).toBe(false);
      expect(downtimeExceeded(undefined, now)).toBe(false);
      expect(downtimeExceeded('', now)).toBe(false);
    });

    it('returns false when heartbeat is recent (<15m)', () => {
      const now = new Date('2026-10-16T12:00:00Z');
      const recent = new Date(now.getTime() - 5 * 60 * 1000); // 5m ago
      expect(downtimeExceeded(recent, now)).toBe(false);
      expect(downtimeExceeded(recent.toISOString(), now)).toBe(false);
    });

    it('returns true when heartbeat exceeds 15 minutes', () => {
      const now = new Date('2026-10-16T12:00:00Z');
      const stale = new Date(now.getTime() - 20 * 60 * 1000); // 20m ago
      expect(downtimeExceeded(stale, now)).toBe(true);
      expect(downtimeExceeded(stale.toISOString(), now)).toBe(true);
    });

    it('supports custom threshold override', () => {
      const now = new Date('2026-10-16T12:00:00Z');
      const hb = new Date(now.getTime() - 10 * 60 * 1000); // 10m ago
      expect(downtimeExceeded(hb, now, 5 * 60 * 1000)).toBe(true);
      expect(downtimeExceeded(hb, now, 15 * 60 * 1000)).toBe(false);
    });
  });

  describe('stricterGap', () => {
    it('enforces recovery minimum gap (600s) if configured is lower or zero', () => {
      expect(stricterGap(0)).toBe(RECOVERY_MIN_GAP_SECONDS);
      expect(stricterGap(300)).toBe(RECOVERY_MIN_GAP_SECONDS);
      expect(stricterGap(undefined)).toBe(RECOVERY_MIN_GAP_SECONDS);
    });

    it('preserves stricter configured gap if higher than recovery minimum', () => {
      expect(stricterGap(900)).toBe(900);
      expect(stricterGap(1200)).toBe(1200);
    });
  });

  describe('nextScheduleSlot', () => {
    it('snaps early morning before startHour to startHour today', () => {
      // Mon 05:00 UTC
      const candidate = new Date('2026-10-19T05:00:00Z');
      const snapped = nextScheduleSlot(candidate, { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] });
      expect(snapped.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    });

    it('snaps evening after endHour to startHour next weekday', () => {
      // Mon 19:00 UTC
      const candidate = new Date('2026-10-19T19:00:00Z');
      const snapped = nextScheduleSlot(candidate, { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] });
      expect(snapped.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    });

    it('skips weekend days to Monday morning', () => {
      // Sat 10:00 UTC
      const candidate = new Date('2026-10-17T10:00:00Z');
      const snapped = nextScheduleSlot(candidate, { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] });
      expect(snapped.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    });

    it('leaves timestamps inside window untouched', () => {
      // Mon 11:30 UTC
      const candidate = new Date('2026-10-19T11:30:00Z');
      const snapped = nextScheduleSlot(candidate, { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] });
      expect(snapped.toISOString()).toBe('2026-10-19T11:30:00.000Z');
    });
  });

  describe('SlotBook and Recovery Pacing', () => {
    it('prevents slots closer than minGapSeconds (600s)', () => {
      const book = new SlotBook();
      const policy: RecoveryPolicy = {
        now: new Date('2026-10-19T09:00:00Z'),
        minGapSeconds: 600,
        maxPerHour: 6,
        todayCap: 50,
      };

      const slot1 = new Date('2026-10-19T09:00:00Z');
      book.occupy(slot1);

      // 5 minutes later: should reject (< 600s)
      const slotTooClose = new Date('2026-10-19T09:05:00Z');
      expect(book.fits(slotTooClose, policy)).toBe(false);

      // 10 minutes later: should fit
      const slotOk = new Date('2026-10-19T09:10:00Z');
      expect(book.fits(slotOk, policy)).toBe(true);
    });

    it('caps sends per clock hour to maxPerHour (6/hour)', () => {
      const book = new SlotBook();
      const policy: RecoveryPolicy = {
        now: new Date('2026-10-19T09:00:00Z'),
        minGapSeconds: 600,
        maxPerHour: 6,
        todayCap: 50,
      };

      // Occupy 6 sends in the 09:00-10:00 hour
      for (let min = 0; min < 60; min += 10) {
        book.occupy(new Date(`2026-10-19T09:${min.toString().padStart(2, '0')}:00Z`));
      }
      expect(book.getOccupiedCount()).toBe(6);

      // 7th slot in the same hour must not fit
      const seventhInHour = new Date('2026-10-19T09:59:00Z');
      expect(book.fits(seventhInHour, policy)).toBe(false);

      // Slot in the next hour (10:00) should fit
      const nextHour = new Date('2026-10-19T10:00:00Z');
      expect(book.fits(nextHour, policy)).toBe(true);
    });

    it('respects daily cap and rolls remaining work to next day', () => {
      const book = new SlotBook();
      const policy: RecoveryPolicy = {
        now: new Date('2026-10-19T09:00:00Z'),
        minGapSeconds: 600,
        maxPerHour: 6,
        todayCap: 2, // only 2 sends allowed today
        futureDayCap: 50,
        windows: { startHour: 9, endHour: 17, daysOfWeek: [1, 2, 3, 4, 5] },
      };

      const res1 = book.place(new Date('2026-10-19T09:00:00Z'), policy);
      expect(res1.placed).toBe(true);
      expect(res1.slot.toISOString()).toBe('2026-10-19T09:00:00.000Z');

      const res2 = book.place(new Date('2026-10-19T09:05:00Z'), policy);
      expect(res2.placed).toBe(true);
      expect(res2.slot.toISOString()).toBe('2026-10-19T09:10:00.000Z');

      // 3rd send should be pushed to tomorrow morning at startHour (10-20 09:00:00Z)
      const res3 = book.place(new Date('2026-10-19T09:15:00Z'), policy);
      expect(res3.placed).toBe(true);
      expect(res3.slot.toISOString()).toBe('2026-10-20T09:00:00.000Z');
    });

    it('redistributes 15 overdue items into spaced slots across sending window', () => {
      const book = new SlotBook();
      const policy: RecoveryPolicy = {
        now: new Date('2026-10-19T08:00:00Z'), // Monday 8am
        minGapSeconds: 600,
        maxPerHour: 6,
        todayCap: 50,
        windows: { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] },
      };

      const overdueTime = new Date('2026-10-19T07:00:00Z'); // 1 hour ago
      const slots: Date[] = [];

      for (let i = 0; i < 15; i++) {
        const res = book.place(overdueTime, policy);
        expect(res.placed).toBe(true);
        slots.push(res.slot);
      }

      expect(slots.length).toBe(15);
      // First slot is at 8:00
      expect(slots[0].toISOString()).toBe('2026-10-19T08:00:00.000Z');
      // 6th slot is at 8:50
      expect(slots[5].toISOString()).toBe('2026-10-19T08:50:00.000Z');
      // 7th slot rolls into next hour: 9:00 (due to maxPerHour: 6)
      expect(slots[6].toISOString()).toBe('2026-10-19T09:00:00.000Z');
      // Ensure strictly ascending and at least 10m gap between all placed slots
      for (let i = 1; i < slots.length; i++) {
        const gap = slots[i].getTime() - slots[i - 1].getTime();
        expect(gap).toBeGreaterThanOrEqual(600 * 1000);
      }
    });

    it('handles initial slots passed to constructor', () => {
      const book = new SlotBook(['2026-10-19T09:00:00Z', new Date('2026-10-19T09:30:00Z')]);
      expect(book.getOccupiedCount()).toBe(2);

      const policy: RecoveryPolicy = {
        now: new Date('2026-10-19T09:00:00Z'),
        minGapSeconds: 600,
        maxPerHour: 6,
        todayCap: 50,
      };

      // 09:05 conflicts with 09:00
      expect(book.fits(new Date('2026-10-19T09:05:00Z'), policy)).toBe(false);
      // 09:15 is >10m away from 09:00 and 09:30
      expect(book.fits(new Date('2026-10-19T09:15:00Z'), policy)).toBe(true);
    });

    it('gracefully handles null or invalid timestamps in occupy', () => {
      const book = new SlotBook();
      book.occupy(null);
      book.occupy(undefined);
      book.occupy('invalid-date');
      expect(book.getOccupiedCount()).toBe(0);
    });
  });

  describe('MongoDB state helpers', () => {
    it('recordHeartbeat, getSchedulerState, and recordRecoverySummary operate correctly', async () => {
      const store = new Map<string, any>();
      const mockDb: any = {
        collection: (name: string) => {
          expect(name).toBe('scheduler_state');
          return {
            findOne: async (query: any) => store.get(query._id) || null,
            updateOne: async (filter: any, update: any, options: any) => {
              const current = store.get(filter._id) || { _id: filter._id };
              const setFields = update.$set || {};
              store.set(filter._id, { ...current, ...setFields });
              return { acknowledged: true };
            },
          };
        },
      };

      const { recordHeartbeat, getSchedulerState, recordRecoverySummary } = await import('../../lib/scheduler-recovery');

      // Initial state is null
      const initial = await getSchedulerState(mockDb);
      expect(initial).toBeNull();

      // Record heartbeat
      await recordHeartbeat(mockDb, { mode: 'normal' });
      const afterHb = await getSchedulerState(mockDb);
      expect(afterHb).not.toBeNull();
      expect(afterHb?.lastHeartbeatAt).toBeTruthy();
      expect(afterHb?.lastRecoveryAt).toBeUndefined();

      // Record recovery summary
      const summary = {
        startedAt: '2026-10-16T12:00:00Z',
        completedAt: '2026-10-16T12:00:05Z',
        downtimeSeconds: 1200,
        candidatesFound: 10,
        cancelledReply: 1,
        cancelledSuppression: 1,
        heldPaused: 0,
        manualTasksMaterialized: 2,
        automatedRescheduled: 6,
        sameDayCount: 4,
        futureDayCount: 2,
      };
      await recordRecoverySummary(mockDb, summary);
      const afterRecovery = await getSchedulerState(mockDb);
      expect(afterRecovery?.lastRecoveryAt).toBeTruthy();
      expect(afterRecovery?.lastRecoverySummary?.automatedRescheduled).toBe(6);
      expect(afterRecovery?.lastRecoverySummary?.cancelledReply).toBe(1);
    });
  });
});

