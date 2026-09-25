import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Meeting scheduler (issue #207) — pure slot-computation, rate-limit
// decision, and availability-window validation logic. Zero DB, zero
// network, fully unit-testable in isolation from
// app/lib/scheduling-store.ts's Mongo/Google Calendar API orchestration.
//
// Uses dayjs's own utc/timezone plugins (already an installed dependency —
// dayjs itself ships in package.json for @mantine/dates — not a new
// addition) for DST-correct IANA-timezone math, rather than hand-rolling
// Intl.DateTimeFormat parsing.

export type BusyInterval = { start: string; end: string }; // ISO, UTC

export type AvailabilityWindow = {
  weekdays: number[]; // 0=Sun..6=Sat, in the given IANA timeZone
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  slotMinutes: number;
  bufferMinutes: number;
};

export const DEFAULT_AVAILABILITY_WINDOW: AvailabilityWindow = {
  weekdays: [1, 2, 3, 4, 5], // Mon-Fri
  startMinuteOfDay: 9 * 60,
  endMinuteOfDay: 17 * 60,
  slotMinutes: 30,
  bufferMinutes: 0,
};

export type Slot = { start: string; end: string }; // ISO, UTC

const MIN_LEAD_TIME_MS = 60 * 60 * 1000; // 1 hour — never offer a slot starting sooner than this

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Computes every open slot in [rangeStart, rangeEnd) against the given
// availability window (interpreted in `timeZone`, DST-correct by
// construction since dayjs.tz derives wall-clock hours from the real IANA
// database, not a fixed UTC offset) and real busy intervals.
export function computeAvailableSlots(params: {
  rangeStart: string;
  rangeEnd: string;
  timeZone: string;
  window: AvailabilityWindow;
  busy: BusyInterval[];
  now?: string;
}): Slot[] {
  const { timeZone, window, busy } = params;
  const rangeStart = dayjs.utc(params.rangeStart);
  const rangeEnd = dayjs.utc(params.rangeEnd);
  const now = params.now ? dayjs.utc(params.now) : dayjs.utc();
  const minStart = now.valueOf() + MIN_LEAD_TIME_MS;

  const busyIntervals = busy.map((b) => ({ start: dayjs.utc(b.start).valueOf(), end: dayjs.utc(b.end).valueOf() }));

  const slots: Slot[] = [];
  let cursorDay = rangeStart.tz(timeZone).startOf('day');
  const rangeEndTz = rangeEnd.tz(timeZone);

  while (cursorDay.isBefore(rangeEndTz)) {
    const weekday = cursorDay.day();
    if (window.weekdays.includes(weekday)) {
      for (let minute = window.startMinuteOfDay; minute + window.slotMinutes <= window.endMinuteOfDay; minute += window.slotMinutes) {
        const slotStart = cursorDay.add(minute, 'minute');
        const slotEnd = slotStart.add(window.slotMinutes, 'minute');
        if (slotStart.valueOf() < rangeStart.valueOf() || slotEnd.valueOf() > rangeEnd.valueOf()) continue;
        if (slotStart.valueOf() < minStart) continue;

        const expandedStart = slotStart.valueOf() - window.bufferMinutes * 60_000;
        const expandedEnd = slotEnd.valueOf() + window.bufferMinutes * 60_000;
        const conflicts = busyIntervals.some((b) => intervalsOverlap(expandedStart, expandedEnd, b.start, b.end));
        if (!conflicts) {
          slots.push({ start: slotStart.utc().toISOString(), end: slotEnd.utc().toISOString() });
        }
      }
    }
    cursorDay = cursorDay.add(1, 'day');
  }

  return slots;
}

export function isSlotStillAvailable(slot: Slot, freshSlots: Slot[]): boolean {
  return freshSlots.some((s) => s.start === slot.start && s.end === slot.end);
}

// Simple, DB-backed rate-limit decision (app/lib/scheduling-store.ts owns
// the actual counting query) — pure threshold check, unit-testable without
// a database.
export function isRateLimited(recentRequestCount: number, limit: number): boolean {
  return recentRequestCount >= limit;
}

export function isValidAvailabilityWindow(value: unknown): value is AvailabilityWindow {
  if (!value || typeof value !== 'object') return false;
  const w = value as Record<string, unknown>;
  return (
    Array.isArray(w.weekdays) && w.weekdays.every((d) => typeof d === 'number' && d >= 0 && d <= 6) &&
    typeof w.startMinuteOfDay === 'number' && w.startMinuteOfDay >= 0 && w.startMinuteOfDay < 1440 &&
    typeof w.endMinuteOfDay === 'number' && w.endMinuteOfDay > (w.startMinuteOfDay as number) && w.endMinuteOfDay <= 1440 &&
    typeof w.slotMinutes === 'number' && w.slotMinutes > 0 && w.slotMinutes <= 240 &&
    typeof w.bufferMinutes === 'number' && w.bufferMinutes >= 0 && w.bufferMinutes <= 120
  );
}
