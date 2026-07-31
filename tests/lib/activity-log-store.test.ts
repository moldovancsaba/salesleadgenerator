import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  mapOutreachLogToActivityEntry, mapActivityLogDoc, mergeActivityTimeline,
} from '../../app/lib/activity-log-store';

describe('mapOutreachLogToActivityEntry (issue #140)', () => {
  it('maps an outreach_logs document into an ActivityEntry with type email-outbound', () => {
    const entry = mapOutreachLogToActivityEntry({
      _id: new ObjectId(),
      leadId: 'lead-1',
      subject: 'Quick intro',
      body: 'Hello there, following up on our conversation.',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(entry.type).toBe('email-outbound');
    expect(entry.direction).toBe('outbound');
    expect(entry.source).toBe('outreach-log');
    expect(entry.subject).toBe('Quick intro');
    expect(entry.createdAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('truncates a long body to a bounded excerpt', () => {
    const longBody = 'x'.repeat(500);
    const entry = mapOutreachLogToActivityEntry({
      _id: new ObjectId(), leadId: 'lead-1', body: longBody, createdAt: new Date(),
    });
    expect(entry.bodyExcerpt!.length).toBeLessThanOrEqual(281);
    expect(entry.bodyExcerpt!.endsWith('…')).toBe(true);
  });

  it('leaves bodyExcerpt undefined when there is no body', () => {
    const entry = mapOutreachLogToActivityEntry({ _id: new ObjectId(), leadId: 'lead-1', createdAt: new Date() });
    expect(entry.bodyExcerpt).toBeUndefined();
  });
});

describe('mapActivityLogDoc (issue #140)', () => {
  it('maps a raw activityLog document, defaulting matchedContactKey to null', () => {
    const entry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'email-inbound', direction: 'inbound',
      fromAddress: 'lead@example.com', source: 'inbound-webhook', createdAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    expect(entry.type).toBe('email-inbound');
    expect(entry.direction).toBe('inbound');
    expect(entry.fromAddress).toBe('lead@example.com');
    expect(entry.matchedContactKey).toBeNull();
    expect(entry.source).toBe('inbound-webhook');
  });

  it('preserves an explicit matchedContactKey', () => {
    const entry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'email-inbound', direction: 'inbound',
      matchedContactKey: 'jane doe|jane@example.com', source: 'inbound-webhook', createdAt: new Date(),
    });
    expect(entry.matchedContactKey).toBe('jane doe|jane@example.com');
  });
});

describe('mergeActivityTimeline (issue #140)', () => {
  const entry = (id: string, createdAt: string) => mapOutreachLogToActivityEntry({
    _id: new ObjectId(), leadId: 'lead-1', subject: id, createdAt: new Date(createdAt),
  });

  it('merges multiple sources sorted newest-first', () => {
    const a = [entry('a1', '2026-07-01T00:00:00.000Z'), entry('a2', '2026-06-01T00:00:00.000Z')];
    const b = [entry('b1', '2026-07-15T00:00:00.000Z')];
    const merged = mergeActivityTimeline([a, b], 10);
    expect(merged.map((e) => e.subject)).toEqual(['b1', 'a1', 'a2']);
  });

  it('truncates to the given limit after merging', () => {
    const a = [entry('a1', '2026-07-03T00:00:00.000Z'), entry('a2', '2026-07-02T00:00:00.000Z')];
    const b = [entry('b1', '2026-07-01T00:00:00.000Z')];
    const merged = mergeActivityTimeline([a, b], 2);
    expect(merged.map((e) => e.subject)).toEqual(['a1', 'a2']);
  });

  it('returns [] for empty sources', () => {
    expect(mergeActivityTimeline([[], []], 10)).toEqual([]);
  });
});
