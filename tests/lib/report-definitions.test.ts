import { describe, it, expect } from 'vitest';
import { computeNextRunAt, validateAndBuildSchedule, validateReportDefinitionInput, buildReportDefinition } from '../../lib/report-definitions';

describe('computeNextRunAt (issue 212)', () => {
  it('daily: advances to the next day if the hour already passed today', () => {
    const from = new Date('2026-06-15T10:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hourUtc: 9 }, from);
    expect(next).toBe('2026-06-16T09:00:00.000Z');
  });

  it('daily: stays today if the hour has not passed yet', () => {
    const from = new Date('2026-06-15T05:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hourUtc: 9 }, from);
    expect(next).toBe('2026-06-15T09:00:00.000Z');
  });

  it('weekly: lands on the correct future day-of-week', () => {
    // 2026-06-15 is a Monday (dow=1); target Wednesday (dow=3).
    const from = new Date('2026-06-15T05:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'weekly', hourUtc: 9, dayOfWeek: 3 }, from);
    expect(new Date(next).getUTCDay()).toBe(3);
    expect(new Date(next).getTime()).toBeGreaterThan(from.getTime());
  });

  it('weekly: rolls to next week when today is the target day but the hour already passed', () => {
    const from = new Date('2026-06-15T10:00:00.000Z'); // Monday, dow=1, past 9am
    const next = computeNextRunAt({ frequency: 'weekly', hourUtc: 9, dayOfWeek: 1 }, from);
    expect(next).toBe('2026-06-22T09:00:00.000Z');
  });

  it('monthly: advances to next month when the target day already passed', () => {
    const from = new Date('2026-06-15T00:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'monthly', hourUtc: 9, dayOfMonth: 10 }, from);
    expect(next).toBe('2026-07-10T09:00:00.000Z');
  });

  it('monthly: stays this month when the target day has not arrived yet', () => {
    const from = new Date('2026-06-05T00:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'monthly', hourUtc: 9, dayOfMonth: 20 }, from);
    expect(next).toBe('2026-06-20T09:00:00.000Z');
  });

  it('monthly: a dayOfMonth beyond the 28-cap is clamped, never overflowing into the wrong month', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'monthly', hourUtc: 9, dayOfMonth: 31 }, from);
    expect(new Date(next).getUTCMonth()).toBe(5); // June (0-indexed), never rolled into July
    expect(new Date(next).getUTCDate()).toBe(28);
  });
});

describe('validateAndBuildSchedule (issue 212)', () => {
  it('rejects a weekly schedule with no dayOfWeek', () => {
    const result = validateAndBuildSchedule({ frequency: 'weekly', hourUtc: 9, recipients: ['a@example.com'] });
    expect(result.valid).toBe(false);
  });

  it('rejects a monthly schedule with dayOfMonth 29+ (§9/§15 edge case)', () => {
    const result = validateAndBuildSchedule({ frequency: 'monthly', hourUtc: 9, dayOfMonth: 29, recipients: ['a@example.com'] });
    expect(result.valid).toBe(false);
  });

  it('rejects zero recipients', () => {
    const result = validateAndBuildSchedule({ frequency: 'daily', hourUtc: 9, recipients: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects an invalid email address', () => {
    const result = validateAndBuildSchedule({ frequency: 'daily', hourUtc: 9, recipients: ['not-an-email'] });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid daily schedule and computes nextRunAt', () => {
    const result = validateAndBuildSchedule({ frequency: 'daily', hourUtc: 9, recipients: ['a@example.com'] }, new Date('2026-06-15T00:00:00.000Z'));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.nextRunAt).toBe('2026-06-15T09:00:00.000Z');
  });

  it('defaults enabled to false when not explicitly true', () => {
    const result = validateAndBuildSchedule({ frequency: 'daily', hourUtc: 9, recipients: ['a@example.com'] });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.enabled).toBe(false);
  });
});

describe('validateReportDefinitionInput (issue 212)', () => {
  const validBase = { name: 'My Report', chartType: 'table', metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'all' } };

  it('accepts a minimal valid definition with no schedule', () => {
    expect(validateReportDefinitionInput(validBase).valid).toBe(true);
  });

  it('rejects a blank name', () => {
    expect(validateReportDefinitionInput({ ...validBase, name: '   ' }).valid).toBe(false);
  });

  it('rejects an invalid chartType', () => {
    expect(validateReportDefinitionInput({ ...validBase, chartType: 'pie' }).valid).toBe(false);
  });

  it('propagates report-input validation errors (e.g. unknown metric)', () => {
    const result = validateReportDefinitionInput({ ...validBase, metric: 'not_real' });
    expect(result.valid).toBe(false);
  });

  it('propagates schedule validation errors when a schedule is present', () => {
    const result = validateReportDefinitionInput({ ...validBase, schedule: { frequency: 'weekly', hourUtc: 9, recipients: [] } });
    expect(result.valid).toBe(false);
  });

  it('accepts null schedule (unscheduled report)', () => {
    expect(validateReportDefinitionInput({ ...validBase, schedule: null }).valid).toBe(true);
  });
});

describe('buildReportDefinition (issue 212)', () => {
  const validBase = { name: 'My Report', chartType: 'table', metric: 'lead_count', groupBy: ['industry'], filters: [], dateRange: { mode: 'all' } };

  it('stamps createdBy, createdAt, updatedAt on a new definition', () => {
    const def = buildReportDefinition('cogmap', 'default', validBase, { createdBy: 'rep@example.com', now: new Date('2026-06-15T00:00:00.000Z') });
    expect(def.createdBy).toBe('rep@example.com');
    expect(def.createdAt).toBe('2026-06-15T00:00:00.000Z');
    expect(def.updatedAt).toBe('2026-06-15T00:00:00.000Z');
  });

  it('preserves id/createdBy/createdAt across an edit of an existing definition', () => {
    const original = buildReportDefinition('cogmap', 'default', validBase, { createdBy: 'rep@example.com', now: new Date('2026-06-15T00:00:00.000Z') });
    const later = new Date('2026-06-20T00:00:00.000Z');
    const edited = buildReportDefinition('cogmap', 'default', { ...validBase, name: 'Renamed' }, { existing: original, createdBy: 'someone-else@example.com', now: later });
    expect(edited.id).toBe(original.id);
    expect(edited.createdBy).toBe('rep@example.com');
    expect(edited.createdAt).toBe(original.createdAt);
    expect(edited.updatedAt).toBe(later.toISOString());
    expect(edited.name).toBe('Renamed');
  });

  it('stamps brand/tenantId onto the definition', () => {
    const def = buildReportDefinition('seyu', 'tenant-x', validBase, { createdBy: 'rep@example.com' });
    expect(def.brand).toBe('seyu');
    expect(def.tenantId).toBe('tenant-x');
  });
});
