// Today execution surface domain logic & date math (issue #237 — CRM Handoff 06 ingestion).
// Provides pure calculation helpers for calendar windows, snooze math,
// and Today view data models.

export type TodayCadenceTask = {
  leadId: string;
  entityName: string;
  contactName?: string;
  contactEmail?: string;
  contactKey?: string;
  channel: 'call' | 'linkedin' | 'general';
  reminderNote?: string;
  taskDueAt: string;
  stepIndex: number;
  totalSteps?: number;
  cadenceName?: string;
  assignedTo?: string;
};

export type TodayFollowUp = {
  leadId: string;
  entityName: string;
  contactName?: string;
  contactEmail?: string;
  contactKey?: string;
  nextActionNote?: string;
  nextActionDueAt: string;
  overdueDays: number;
  assignedTo?: string;
};

export type TodayDealAttention = {
  leadId: string;
  dealId?: string;
  entityName: string;
  dealTitle?: string;
  dealValue?: number;
  pipelineStage?: string;
  expectedCloseDate?: string;
  daysOverdueOrInactive: number;
  reason: 'past_close_date' | 'stale_stage';
};

export type TodayInboundItem = {
  leadId: string;
  entityName: string;
  source: 'inbound' | 'LINKEDIN_EXTENSION' | string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  linkedinUrl?: string;
  buyingRole?: string;
  createdAt: string;
  notes?: string;
};

export type TodayViewData = {
  date: string;
  timezone: string;
  scope: 'mine' | 'all';
  counts: {
    total: number;
    cadenceTasks: number;
    overdueFollowUps: number;
    dueTodayFollowUps: number;
    dealsNeedingAttention: number;
    inboundQueue: number;
  };
  cadenceTasks: TodayCadenceTask[];
  overdueFollowUps: TodayFollowUp[];
  dueTodayFollowUps: TodayFollowUp[];
  dealsNeedingAttention: TodayDealAttention[];
  inboundQueue: TodayInboundItem[];
};

/**
 * Calculates the local calendar day [dayStart, dayEnd) for a given timezone and reference date.
 * Gracefully falls back to UTC if the timezone string is invalid or unparseable.
 */
export function parseTodayWindow(
  timezone?: string,
  now?: Date
): { dayStart: Date; dayEnd: Date; dateStr: string; timezone: string } {
  const ref = now ?? new Date();
  const tz = (timezone && typeof timezone === 'string' ? timezone.trim() : '') || 'UTC';

  let resolvedTz = tz;
  let dateParts: { year: number; month: number; day: number } | null = null;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(ref);
    let y = 0;
    let m = 0;
    let d = 0;
    for (const part of parts) {
      if (part.type === 'year') y = parseInt(part.value, 10);
      if (part.type === 'month') m = parseInt(part.value, 10);
      if (part.type === 'day') d = parseInt(part.value, 10);
    }
    if (y && m && d) {
      dateParts = { year: y, month: m, day: d };
    }
  } catch {
    // Invalid timezone — fall back to UTC
    resolvedTz = 'UTC';
  }

  if (!dateParts) {
    resolvedTz = 'UTC';
    dateParts = {
      year: ref.getUTCFullYear(),
      month: ref.getUTCMonth() + 1,
      day: ref.getUTCDate(),
    };
  }

  // Construct dayStart and dayEnd in UTC or target representation
  const monthStr = String(dateParts.month).padStart(2, '0');
  const dayStr = String(dateParts.day).padStart(2, '0');
  const dateStr = `${dateParts.year}-${monthStr}-${dayStr}`;

  // Use UTC timestamp for the day boundaries
  const dayStart = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + 1, 0, 0, 0, 0));

  return {
    dayStart,
    dayEnd,
    dateStr,
    timezone: resolvedTz,
  };
}

/**
 * Computes a new due date based on a snooze preset ('1d', '3d', '1w') or ISO string.
 */
export function computeSnoozeDate(duration: string, fromDate?: Date): Date {
  const base = fromDate ?? new Date();
  const cleanDuration = (duration || '').trim().toLowerCase();

  switch (cleanDuration) {
    case '1d':
    case 'tomorrow':
      return new Date(base.getTime() + 1 * 24 * 60 * 60 * 1000);
    case '3d':
      return new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
    case '1w':
    case '7d':
      return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
    case '2w':
    case '14d':
      return new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000);
    default: {
      const parsed = new Date(duration);
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > base.getTime()) {
        return parsed;
      }
      // Default to 1 day if unrecognized
      return new Date(base.getTime() + 1 * 24 * 60 * 60 * 1000);
    }
  }
}

/**
 * Computes the number of calendar days overdue relative to now.
 * Returns 0 if due today or in the future.
 */
export function computeOverdueDays(dueIso: string, now?: Date): number {
  const ref = now ?? new Date();
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return 0;

  // Compare calendar day boundaries
  const refDay = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());

  const diffDays = Math.floor((refDay - dueDay) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays);
}
