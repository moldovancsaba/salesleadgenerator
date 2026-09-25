// Ad-hoc report builder (issue #212) — the ReportDefinition/ReportSchedule
// data model, plus pure sanitize/validate and schedule-math helpers. No
// Mongo import — mirrors lib/cadences.ts's own module split (pure logic
// here, the Mongo-aware store lives in app/lib/report-store.ts).

import { validateReportInput, type ReportMetric, type ReportGroupByField, type ReportFilter, type ReportDateRange } from './report-pipeline';

export type ReportChartType = 'bar' | 'line' | 'table';

export type ReportSchedule = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  hourUtc: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  recipients: string[];
  nextRunAt: string;
};

export type ReportDefinition = {
  id: string;
  brand: string;
  tenantId: string;
  name: string;
  metric: ReportMetric;
  groupBy: ReportGroupByField[];
  filters: ReportFilter[];
  dateRange: ReportDateRange;
  chartType: ReportChartType;
  schedule: ReportSchedule | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'ok' | 'error';
  lastRunError?: string;
};

const MAX_NAME_LENGTH = 200;
const MAX_RECIPIENTS = 20;
const MAX_DAY_OF_MONTH = 28; // capped to avoid month-length edge cases (issue #212 §9/§15)
const CHART_TYPES: ReportChartType[] = ['bar', 'line', 'table'];
// Deliberately permissive (not a full RFC 5322 parser) — same "good enough
// to catch a typo, not a validator of the email spec" bar this repo already
// applies elsewhere (e.g. outreach template variable checks).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

export function computeNextRunAt(schedule: Pick<ReportSchedule, 'frequency' | 'hourUtc' | 'dayOfWeek' | 'dayOfMonth'>, from: Date): string {
  const next = new Date(from.getTime());
  next.setUTCHours(schedule.hourUtc, 0, 0, 0);

  if (schedule.frequency === 'daily') {
    if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  } else if (schedule.frequency === 'weekly') {
    const targetDow = schedule.dayOfWeek ?? 0;
    // Bounded loop — at most 7 iterations to land on the right day-of-week,
    // plus at most 1 more if that day's own time already passed today.
    for (let i = 0; i < 8; i++) {
      if (next.getUTCDay() === targetDow && next.getTime() > from.getTime()) break;
      next.setUTCDate(next.getUTCDate() + 1);
    }
  } else {
    const targetDom = Math.min(schedule.dayOfMonth ?? 1, MAX_DAY_OF_MONTH);
    next.setUTCDate(targetDom);
    if (next.getTime() <= from.getTime()) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(targetDom);
    }
  }

  return next.toISOString();
}

export type ScheduleValidationResult = { valid: true; value: ReportSchedule } | { valid: false; errors: string[] };

export function validateAndBuildSchedule(input: any, now: Date = new Date()): ScheduleValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, errors: ['schedule must be an object'] };

  const frequency = input.frequency;
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
    errors.push("frequency must be 'daily', 'weekly', or 'monthly'");
  }
  const hourUtc = Number(input.hourUtc);
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) errors.push('hourUtc must be an integer 0-23');

  let dayOfWeek: number | undefined;
  if (frequency === 'weekly') {
    dayOfWeek = Number(input.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) errors.push('dayOfWeek (0-6) is required for a weekly schedule');
  }

  let dayOfMonth: number | undefined;
  if (frequency === 'monthly') {
    dayOfMonth = Number(input.dayOfMonth);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > MAX_DAY_OF_MONTH) {
      errors.push(`dayOfMonth (1-${MAX_DAY_OF_MONTH}) is required for a monthly schedule`);
    }
  }

  const recipients: string[] = Array.isArray(input.recipients) ? input.recipients : [];
  if (recipients.length === 0) errors.push('at least one recipient is required');
  if (recipients.length > MAX_RECIPIENTS) errors.push(`too many recipients (max ${MAX_RECIPIENTS})`);
  const cleanRecipients = recipients.map((r) => (typeof r === 'string' ? r.trim() : '')).filter(Boolean);
  for (const r of cleanRecipients) {
    if (!EMAIL_RE.test(r)) errors.push(`invalid recipient email: ${r}`);
  }

  const enabled = input.enabled === true;

  if (errors.length > 0) return { valid: false, errors };

  const base = { frequency, hourUtc, dayOfWeek, dayOfMonth };
  return {
    valid: true,
    value: {
      enabled,
      frequency,
      hourUtc,
      dayOfWeek,
      dayOfMonth,
      recipients: cleanRecipients,
      nextRunAt: computeNextRunAt(base, now),
    },
  };
}

export type ReportDefinitionValidationResult = { valid: true } | { valid: false; errors: string[] };

// Validates a full create/update payload without constructing anything —
// the API route calls this first, then buildReportDefinition() only once
// this passes, mirroring the validate/build split lib/automation-rules.ts
// already established (issue #201).
export function validateReportDefinitionInput(input: any): ReportDefinitionValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, errors: ['input must be an object'] };

  if (!sanitizeName(input.name)) errors.push('name is required');
  if (!CHART_TYPES.includes(input.chartType)) errors.push(`chartType must be one of: ${CHART_TYPES.join(', ')}`);

  const reportInputResult = validateReportInput(input);
  if (!reportInputResult.valid) errors.push(...reportInputResult.errors);

  if (input.schedule !== null && input.schedule !== undefined) {
    const scheduleResult = validateAndBuildSchedule(input.schedule);
    if (!scheduleResult.valid) errors.push(...scheduleResult.errors.map((e) => `schedule: ${e}`));
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export type BuildReportDefinitionOptions = {
  now?: Date;
  existing?: ReportDefinition | null;
  createdBy: string;
};

// Only ever called after validateReportDefinitionInput() has already
// passed — assumes valid input, mirroring lib/automation-rules.ts's own
// sanitizeAutomationRule() contract.
export function buildReportDefinition(brand: string, tenantId: string, input: any, options: BuildReportDefinitionOptions): ReportDefinition {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const existing = options.existing ?? null;

  const reportInputResult = validateReportInput(input);
  const reportInput = reportInputResult.valid ? reportInputResult.value : { metric: 'lead_count' as const, groupBy: [], filters: [], dateRange: { mode: 'all' as const } };

  let schedule: ReportSchedule | null = null;
  if (input.schedule) {
    const scheduleResult = validateAndBuildSchedule(input.schedule, now);
    if (scheduleResult.valid) schedule = scheduleResult.value;
  }

  return {
    id: existing?.id ?? `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    brand,
    tenantId,
    name: sanitizeName(input.name),
    metric: reportInput.metric,
    groupBy: reportInput.groupBy,
    filters: reportInput.filters,
    dateRange: reportInput.dateRange,
    chartType: input.chartType,
    schedule,
    createdBy: existing?.createdBy ?? options.createdBy,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    lastRunAt: existing?.lastRunAt,
    lastRunStatus: existing?.lastRunStatus,
    lastRunError: existing?.lastRunError,
  };
}
