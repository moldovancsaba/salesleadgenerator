import { describe, it, expect } from 'vitest';
import {
  sanitizeAutomationTrigger,
  sanitizeAutomationAction,
  sanitizeAutomationRule,
  validateAutomationRule,
  computeSetNextActionFields,
  buildNotificationLogEntry,
  matchesEventTrigger,
} from '../../lib/automation-rules';

describe('sanitizeAutomationTrigger', () => {
  it('accepts lead_created and lead_assigned with no extra fields', () => {
    expect(sanitizeAutomationTrigger({ type: 'lead_created' })).toEqual({ type: 'lead_created' });
    expect(sanitizeAutomationTrigger({ type: 'lead_assigned' })).toEqual({ type: 'lead_assigned' });
  });

  it('accepts lead_moved_to_column with a non-empty, uppercased column', () => {
    expect(sanitizeAutomationTrigger({ type: 'lead_moved_to_column', column: 'engaged' })).toEqual({
      type: 'lead_moved_to_column',
      column: 'ENGAGED',
    });
  });

  it('rejects lead_moved_to_column with no column', () => {
    expect(sanitizeAutomationTrigger({ type: 'lead_moved_to_column' })).toBeNull();
    expect(sanitizeAutomationTrigger({ type: 'lead_moved_to_column', column: '' })).toBeNull();
  });

  it('accepts stale_no_activity with a positive thresholdDays, rounded and capped', () => {
    expect(sanitizeAutomationTrigger({ type: 'stale_no_activity', thresholdDays: 14.6 })).toEqual({
      type: 'stale_no_activity',
      thresholdDays: 15,
    });
    expect(sanitizeAutomationTrigger({ type: 'stale_no_activity', thresholdDays: 999999 })).toEqual({
      type: 'stale_no_activity',
      thresholdDays: 3650,
    });
  });

  it('rejects stale_no_activity with a non-positive or missing thresholdDays', () => {
    expect(sanitizeAutomationTrigger({ type: 'stale_no_activity', thresholdDays: 0 })).toBeNull();
    expect(sanitizeAutomationTrigger({ type: 'stale_no_activity' })).toBeNull();
  });

  it('rejects an unrecognized type and a malformed input', () => {
    expect(sanitizeAutomationTrigger({ type: 'not_a_real_trigger' })).toBeNull();
    expect(sanitizeAutomationTrigger(null)).toBeNull();
    expect(sanitizeAutomationTrigger('lead_created')).toBeNull();
  });
});

describe('sanitizeAutomationAction', () => {
  it('sanitizes set_next_action, clamping dueInDays and trimming note', () => {
    expect(sanitizeAutomationAction({ type: 'set_next_action', dueInDays: 3.4, note: '  Call back  ' })).toEqual({
      type: 'set_next_action',
      dueInDays: 3,
      note: 'Call back',
    });
  });

  it('sanitizes apply_tag, trimming and length-capping the tag', () => {
    expect(sanitizeAutomationAction({ type: 'apply_tag', tag: '  hot-lead  ' })).toEqual({
      type: 'apply_tag',
      tag: 'hot-lead',
    });
  });

  it('sanitizes log_notification, trimming the message', () => {
    expect(sanitizeAutomationAction({ type: 'log_notification', message: '  Nobody has followed up  ' })).toEqual({
      type: 'log_notification',
      message: 'Nobody has followed up',
    });
  });

  it('rejects an unrecognized type', () => {
    expect(sanitizeAutomationAction({ type: 'send_email' })).toBeNull();
  });
});

describe('sanitizeAutomationRule', () => {
  it('carries a null trigger/action through as a rejectable sentinel rather than defaulting', () => {
    const rule = sanitizeAutomationRule({ name: 'Test', trigger: { type: 'bogus' }, action: { type: 'bogus' } }, 'cogmap', 'default');
    expect(validateAutomationRule(rule).length).toBeGreaterThan(0);
  });

  it('defaults enabled to false when omitted', () => {
    const rule = sanitizeAutomationRule({ name: 'Test', trigger: { type: 'lead_created' }, action: { type: 'apply_tag', tag: 'x' } }, 'cogmap', 'default');
    expect(rule.enabled).toBe(false);
  });
});

describe('validateAutomationRule', () => {
  const validTrigger = { type: 'lead_created' as const };
  const validAction = { type: 'apply_tag' as const, tag: 'hot' };

  it('accepts a fully valid rule', () => {
    expect(validateAutomationRule({ name: 'Rule', trigger: validTrigger, action: validAction, enabled: true })).toEqual([]);
  });

  it('rejects a missing name', () => {
    const errors = validateAutomationRule({ name: '', trigger: validTrigger, action: validAction, enabled: false });
    expect(errors).toContain('name is required');
  });

  it('rejects an apply_tag action with no tag', () => {
    const errors = validateAutomationRule({ name: 'Rule', trigger: validTrigger, action: { type: 'apply_tag', tag: '' }, enabled: false });
    expect(errors.some((e) => e.includes('apply_tag'))).toBe(true);
  });

  it('rejects a log_notification action with no message', () => {
    const errors = validateAutomationRule({ name: 'Rule', trigger: validTrigger, action: { type: 'log_notification', message: '' }, enabled: false });
    expect(errors.some((e) => e.includes('log_notification'))).toBe(true);
  });

  // Issue #201 §15/§18 — the one binding edge case: an enabled lead_assigned
  // rule could never execute (this app has no assignment model), so it must
  // be rejected at save time rather than silently persisted as dead.
  it('rejects an enabled lead_assigned rule', () => {
    const errors = validateAutomationRule({ name: 'Rule', trigger: { type: 'lead_assigned' }, action: validAction, enabled: true });
    expect(errors.some((e) => e.includes('lead_assigned'))).toBe(true);
  });

  it('accepts a DISABLED lead_assigned rule (schema-defined, forward-compatible)', () => {
    const errors = validateAutomationRule({ name: 'Rule', trigger: { type: 'lead_assigned' }, action: validAction, enabled: false });
    expect(errors).toEqual([]);
  });
});

describe('computeSetNextActionFields', () => {
  it('computes an ISO due date dueInDays from now, and passes the note through', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const result = computeSetNextActionFields({ type: 'set_next_action', dueInDays: 3, note: 'Follow up' }, now);
    expect(result.nextActionDueAt).toBe('2026-09-04T00:00:00.000Z');
    expect(result.nextActionNote).toBe('Follow up');
  });

  it('dueInDays: 0 means due immediately', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const result = computeSetNextActionFields({ type: 'set_next_action', dueInDays: 0, note: 'Now' }, now);
    expect(result.nextActionDueAt).toBe(now.toISOString());
  });
});

describe('buildNotificationLogEntry', () => {
  it('builds an activityLog-shaped document with source=manual, type=system', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const entry = buildNotificationLogEntry({ type: 'log_notification', message: 'Auto-flagged' }, 'lead-1', 'default', 'cogmap', now);
    expect(entry).toEqual({
      leadId: 'lead-1',
      tenantId: 'default',
      brand: 'cogmap',
      type: 'system',
      direction: null,
      bodyExcerpt: 'Auto-flagged',
      matchedContactKey: null,
      source: 'manual',
      createdAt: now,
    });
  });
});

describe('matchesEventTrigger', () => {
  it('matches lead_created against the lead_created event', () => {
    expect(matchesEventTrigger({ type: 'lead_created' }, 'lead_created')).toBe(true);
  });

  it('does not match a different trigger type than the event being evaluated', () => {
    expect(matchesEventTrigger({ type: 'lead_created' }, 'lead_moved_to_column')).toBe(false);
  });

  it('matches lead_moved_to_column only when the column agrees with context', () => {
    const trigger = { type: 'lead_moved_to_column' as const, column: 'PROPOSAL' };
    expect(matchesEventTrigger(trigger, 'lead_moved_to_column', { destinationColumn: 'PROPOSAL' })).toBe(true);
    expect(matchesEventTrigger(trigger, 'lead_moved_to_column', { destinationColumn: 'ENGAGED' })).toBe(false);
    expect(matchesEventTrigger(trigger, 'lead_moved_to_column', {})).toBe(false);
  });
});
