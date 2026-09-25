import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  mapOutreachLogToActivityEntry, mapActivityLogDoc, mergeActivityTimeline,
  isValidCallDisposition, CALL_DISPOSITIONS,
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

  // Issue #141 writes leadId: null for a captured event that doesn't yet
  // resolve to a known lead (no contactEmails[] index exists until #142) —
  // mapActivityLogDoc must not throw on that, and the resulting '' leadId
  // must never coincidentally match a real lead's id in the GET
  // /api/leads/[id]/activity route's {leadId: id} filter.
  it('maps a null leadId to an empty string rather than throwing', () => {
    const entry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: null, type: 'email-outbound', direction: 'outbound',
      source: 'inbound-webhook', createdAt: new Date(),
    });
    expect(entry.leadId).toBe('');
  });

  it('preserves an explicit matchedContactKey', () => {
    const entry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'email-inbound', direction: 'inbound',
      matchedContactKey: 'jane doe|jane@example.com', source: 'inbound-webhook', createdAt: new Date(),
    });
    expect(entry.matchedContactKey).toBe('jane doe|jane@example.com');
  });
});

describe('isValidCallDisposition (issue #200)', () => {
  it('accepts every real CallDisposition value', () => {
    for (const d of CALL_DISPOSITIONS) {
      expect(isValidCallDisposition(d)).toBe(true);
    }
  });

  it('rejects an unknown string, a non-string, undefined, and null', () => {
    expect(isValidCallDisposition('answered')).toBe(false);
    expect(isValidCallDisposition(123)).toBe(false);
    expect(isValidCallDisposition(undefined)).toBe(false);
    expect(isValidCallDisposition(null)).toBe(false);
  });
});

describe('mapActivityLogDoc — call entries (issue #200)', () => {
  it('maps callDisposition/callDurationMinutes/loggedBy for a type: call document', () => {
    const entry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'call', direction: 'outbound',
      matchedContactKey: 'jane doe|+1 555 0100', callDisposition: 'connected',
      callDurationMinutes: 12, loggedBy: 'rep@example.com', source: 'manual',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(entry.type).toBe('call');
    expect(entry.direction).toBe('outbound');
    expect(entry.callDisposition).toBe('connected');
    expect(entry.callDurationMinutes).toBe(12);
    expect(entry.loggedBy).toBe('rep@example.com');
    expect(entry.matchedContactKey).toBe('jane doe|+1 555 0100');
  });

  it('drops a corrupted/unknown callDisposition rather than surfacing garbage, and leaves optional call fields undefined for a non-call entry', () => {
    const corrupted = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'call', direction: 'outbound',
      callDisposition: 'not-a-real-value', source: 'manual', createdAt: new Date(),
    });
    expect(corrupted.callDisposition).toBeUndefined();

    const email = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'email-inbound', direction: 'inbound',
      source: 'inbound-webhook', createdAt: new Date(),
    });
    expect(email.callDisposition).toBeUndefined();
    expect(email.callDurationMinutes).toBeUndefined();
    expect(email.loggedBy).toBeUndefined();
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

  it('interleaves a manually-logged call among email entries by createdAt (issue #200)', () => {
    const callEntry = mapActivityLogDoc({
      _id: new ObjectId(), leadId: 'lead-1', type: 'call', direction: 'outbound',
      callDisposition: 'connected', source: 'manual', createdAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    const emails = [entry('a1', '2026-07-15T00:00:00.000Z'), entry('a2', '2026-07-01T00:00:00.000Z')];
    const merged = mergeActivityTimeline([emails, [callEntry]], 10);
    expect(merged.map((e) => e.type)).toEqual(['email-outbound', 'call', 'email-outbound']);
  });
});
