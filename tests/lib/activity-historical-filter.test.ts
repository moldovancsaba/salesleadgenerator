import { describe, it, expect } from 'vitest';
import {
  isMessageHistorical,
  PRE_LEAD_GRACE_WINDOW_MS,
} from '../../lib/lead-timeline-filter';

describe('activity-historical-filter', () => {
  const leadCreatedAt = '2026-10-10T12:00:00.000Z';
  const leadCreatedMs = new Date(leadCreatedAt).getTime();

  it('exports a 48-hour default grace window', () => {
    expect(PRE_LEAD_GRACE_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('returns true when message date is older than (lead.createdAt - 48h)', () => {
    // 72 hours (3 days) before lead creation
    const ancientDate = new Date(leadCreatedMs - 72 * 60 * 60 * 1000).toISOString();
    expect(isMessageHistorical(ancientDate, leadCreatedAt)).toBe(true);

    // 1 year before lead creation
    const yearAgo = '2025-10-10T12:00:00.000Z';
    expect(isMessageHistorical(yearAgo, leadCreatedAt)).toBe(true);
  });

  it('returns false when message date is within the 48-hour grace window', () => {
    // Exactly 24 hours before lead creation (within 48h grace)
    const withinGrace = new Date(leadCreatedMs - 24 * 60 * 60 * 1000).toISOString();
    expect(isMessageHistorical(withinGrace, leadCreatedAt)).toBe(false);

    // 47 hours and 59 minutes before lead creation
    const edgeWithinGrace = new Date(leadCreatedMs - (48 * 60 * 60 * 1000 - 60 * 1000)).toISOString();
    expect(isMessageHistorical(edgeWithinGrace, leadCreatedAt)).toBe(false);
  });

  it('returns false when message date is at or after lead creation', () => {
    // Exactly at lead creation
    expect(isMessageHistorical(leadCreatedAt, leadCreatedAt)).toBe(false);

    // After lead creation
    const afterCreation = '2026-10-11T09:00:00.000Z';
    expect(isMessageHistorical(afterCreation, leadCreatedAt)).toBe(false);
  });

  it('handles custom grace windows correctly', () => {
    const customGrace = 24 * 60 * 60 * 1000; // 24 hours
    // 30 hours before: older than 24h grace window -> historical
    const msgDate = new Date(leadCreatedMs - 30 * 60 * 60 * 1000).toISOString();
    expect(isMessageHistorical(msgDate, leadCreatedAt, customGrace)).toBe(true);

    // 10 hours before: within 24h grace window -> not historical
    const recentDate = new Date(leadCreatedMs - 10 * 60 * 60 * 1000).toISOString();
    expect(isMessageHistorical(recentDate, leadCreatedAt, customGrace)).toBe(false);
  });

  it('handles Date objects and numeric epoch timestamps interchangeably', () => {
    const ancientMs = leadCreatedMs - 100 * 60 * 60 * 1000;
    expect(isMessageHistorical(new Date(ancientMs), new Date(leadCreatedAt))).toBe(true);
    expect(isMessageHistorical(ancientMs, leadCreatedMs)).toBe(true);
  });

  it('safely returns false for edge cases and invalid or missing dates', () => {
    expect(isMessageHistorical('2026-10-01T00:00:00.000Z', null)).toBe(false);
    expect(isMessageHistorical('2026-10-01T00:00:00.000Z', undefined)).toBe(false);
    expect(isMessageHistorical(null, leadCreatedAt)).toBe(false);
    expect(isMessageHistorical(undefined, leadCreatedAt)).toBe(false);
    expect(isMessageHistorical('invalid-date', leadCreatedAt)).toBe(false);
    expect(isMessageHistorical('2026-10-01T00:00:00.000Z', 'invalid-lead-date')).toBe(false);
  });
});
