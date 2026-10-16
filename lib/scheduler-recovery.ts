import type { Db } from 'mongodb';

export const SCHEDULER_RECOVERY_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
export const RECOVERY_MAX_SENDS_PER_HOUR = 6;
export const RECOVERY_MIN_GAP_SECONDS = 600; // 10 minutes (600s)
export const DEFAULT_DAILY_CAP = 50;
export const DEFAULT_MIN_SPACING_SECONDS = 600; // 10 minutes

export type ScheduleWindows = {
  // Days of week active: 0=Sun, 1=Mon, ..., 6=Sat. Defaults to weekdays [1, 2, 3, 4, 5].
  daysOfWeek?: number[];
  // Start hour (0-23) in UTC/local time. Defaults to 8 (8:00 AM).
  startHour?: number;
  // End hour (0-23) in UTC/local time. Defaults to 18 (6:00 PM).
  endHour?: number;
};

export type RecoveryPolicy = {
  now: Date;
  windows?: ScheduleWindows;
  minGapSeconds?: number;
  maxPerHour?: number;
  todayCap?: number;
  futureDayCap?: number;
};

export type RecoverySummary = {
  startedAt: string;
  completedAt?: string;
  downtimeSeconds: number;
  candidatesFound: number;
  cancelledReply: number;
  cancelledSuppression: number;
  heldPaused: number;
  manualTasksMaterialized: number;
  automatedRescheduled: number;
  sameDayCount: number;
  futureDayCount: number;
};

export type SchedulerStateDoc = {
  _id: string;
  lastHeartbeatAt: string;
  lastRecoveryAt?: string;
  lastRecoverySummary?: RecoverySummary;
  updatedAt: string;
};

/**
 * Checks whether scheduler downtime exceeded the allowable threshold (15 minutes).
 * A null, undefined, or zero heartbeat indicates a fresh install/first boot, not downtime.
 */
export function downtimeExceeded(
  lastHeartbeat: Date | string | null | undefined,
  now: Date,
  thresholdMs: number = SCHEDULER_RECOVERY_THRESHOLD_MS
): boolean {
  if (!lastHeartbeat) return false;
  const hbDate = typeof lastHeartbeat === 'string' ? new Date(lastHeartbeat) : lastHeartbeat;
  const hbMs = hbDate.getTime();
  if (isNaN(hbMs) || hbMs === 0) return false;
  return now.getTime() - hbMs > thresholdMs;
}

/**
 * StricterGap returns the recovery-mode spacing: never more aggressive than normal
 * sending, and never looser than RECOVERY_MIN_GAP_SECONDS (600s).
 */
export function stricterGap(configuredMinWaitSeconds?: number): number {
  const gap = RECOVERY_MIN_GAP_SECONDS;
  if (configuredMinWaitSeconds && configuredMinWaitSeconds > gap) {
    return configuredMinWaitSeconds;
  }
  return gap;
}

/**
 * Normalizes a candidate date into the configured schedule window.
 */
export function nextScheduleSlot(candidate: Date, windows?: ScheduleWindows): Date {
  const daysOfWeek = windows?.daysOfWeek ?? [1, 2, 3, 4, 5]; // Mon-Fri
  const startHour = windows?.startHour ?? 8;
  const endHour = windows?.endHour ?? 18;

  const d = new Date(candidate.getTime());

  for (let i = 0; i < 30; i++) {
    const dayOfWeek = d.getUTCDay();
    const currentHour = d.getUTCHours();

    if (!daysOfWeek.includes(dayOfWeek)) {
      // Advance to startHour of next day
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(startHour, 0, 0, 0);
      continue;
    }

    if (currentHour < startHour) {
      d.setUTCHours(startHour, 0, 0, 0);
      return d;
    }

    if (currentHour >= endHour) {
      // Too late today, advance to next day at startHour
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(startHour, 0, 0, 0);
      continue;
    }

    // Inside window
    return d;
  }

  return candidate;
}

/**
 * SlotBook records the occupied timeline of send slots for a brand or mailbox.
 */
export class SlotBook {
  private occupied: number[] = [];

  constructor(initialSlots?: (Date | string)[]) {
    if (initialSlots) {
      for (const slot of initialSlots) {
        this.occupy(slot);
      }
    }
  }

  occupy(t: Date | string | null | undefined): void {
    if (!t) return;
    const ms = typeof t === 'string' ? new Date(t).getTime() : t.getTime();
    if (!isNaN(ms)) {
      this.occupied.push(ms);
      this.occupied.sort((a, b) => a - b);
    }
  }

  getOccupiedCount(): number {
    return this.occupied.length;
  }

  fits(candidate: Date, policy: RecoveryPolicy): boolean {
    const minGapMs = (policy.minGapSeconds ?? RECOVERY_MIN_GAP_SECONDS) * 1000;
    const maxPerHour = policy.maxPerHour ?? RECOVERY_MAX_SENDS_PER_HOUR;
    const cMs = candidate.getTime();

    // Check min spacing against all occupied slots
    for (const oMs of this.occupied) {
      if (Math.abs(cMs - oMs) < minGapMs) {
        return false;
      }
    }

    // Check hourly limit in the candidate's clock hour
    const hourStart = new Date(candidate);
    hourStart.setUTCMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    let countInHour = 0;
    let countInDay = 0;

    const candYear = candidate.getUTCFullYear();
    const candMonth = candidate.getUTCMonth();
    const candDate = candidate.getUTCDate();

    for (const oMs of this.occupied) {
      if (oMs >= hourStart.getTime() && oMs < hourEnd.getTime()) {
        countInHour++;
      }
      const oDate = new Date(oMs);
      if (
        oDate.getUTCFullYear() === candYear &&
        oDate.getUTCMonth() === candMonth &&
        oDate.getUTCDate() === candDate
      ) {
        countInDay++;
      }
    }

    if (countInHour >= maxPerHour) {
      return false;
    }

    // Check daily cap
    const now = policy.now;
    const isToday =
      candYear === now.getUTCFullYear() &&
      candMonth === now.getUTCMonth() &&
      candDate === now.getUTCDate();

    const cap = isToday
      ? (policy.todayCap ?? DEFAULT_DAILY_CAP)
      : (policy.futureDayCap ?? DEFAULT_DAILY_CAP);

    if (cap <= 0 || countInDay >= cap) {
      return false;
    }

    return true;
  }

  /**
   * Places candidate at the earliest compliant slot at or after earliest.
   */
  place(earliest: Date, policy: RecoveryPolicy): { slot: Date; placed: boolean } {
    const minGapMs = (policy.minGapSeconds ?? RECOVERY_MIN_GAP_SECONDS) * 1000;
    let start = earliest.getTime() < policy.now.getTime() ? policy.now : earliest;
    let candidate = nextScheduleSlot(start, policy.windows);

    for (let i = 0; i < 2000; i++) {
      if (this.fits(candidate, policy)) {
        this.occupy(candidate);
        return { slot: candidate, placed: true };
      }

      // If conflicting with an occupied slot, jump to occupied + minGap
      let conflictEndMs = 0;
      for (const oMs of this.occupied) {
        if (Math.abs(candidate.getTime() - oMs) < minGapMs) {
          if (oMs + minGapMs > candidate.getTime()) {
            conflictEndMs = Math.max(conflictEndMs, oMs + minGapMs);
          }
        }
      }

      const nextMs = conflictEndMs > candidate.getTime() ? conflictEndMs : candidate.getTime() + minGapMs;
      const next = new Date(nextMs);
      const snapped = nextScheduleSlot(next, policy.windows);
      if (snapped.getTime() <= candidate.getTime()) {
        candidate = new Date(candidate.getTime() + minGapMs);
      } else {
        candidate = snapped;
      }
    }

    return { slot: candidate, placed: false };
  }
}

/**
 * MongoDB helper to fetch the current scheduler state.
 */
export async function getSchedulerState(db: Db): Promise<SchedulerStateDoc | null> {
  const doc = await db.collection('scheduler_state').findOne({ _id: 'cadence_tick' as any });
  if (!doc) return null;
  return {
    _id: String(doc._id),
    lastHeartbeatAt: doc.lastHeartbeatAt,
    lastRecoveryAt: doc.lastRecoveryAt,
    lastRecoverySummary: doc.lastRecoverySummary,
    updatedAt: doc.updatedAt,
  };
}

/**
 * MongoDB helper to update the scheduler heartbeat.
 */
export async function recordHeartbeat(db: Db, meta?: Record<string, any>): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  await db.collection('scheduler_state').updateOne(
    { _id: 'cadence_tick' as any },
    {
      $set: {
        lastHeartbeatAt: nowIso,
        updatedAt: nowIso,
        ...(meta ? { metadata: meta } : {}),
      },
    },
    { upsert: true }
  );
}

/**
 * MongoDB helper to record a completed recovery summary.
 */
export async function recordRecoverySummary(
  db: Db,
  summary: RecoverySummary
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.collection('scheduler_state').updateOne(
    { _id: 'cadence_tick' as any },
    {
      $set: {
        lastRecoveryAt: nowIso,
        lastRecoverySummary: summary,
        updatedAt: nowIso,
      },
    },
    { upsert: true }
  );
}
