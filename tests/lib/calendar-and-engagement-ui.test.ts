import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  deriveCalendarEventId,
  computeEventTimes,
} from '../../lib/gcal-sync';
import {
  computeEngagementRates,
  TRACKING_CAVEATS_DISCLOSURE,
  AUTO_OPENS_TIP,
  UNIQUE_RATE_TIP,
  type OutreachLogItem,
} from '../../lib/email-engagement';

describe('Calendar Settings and Email Engagement UI (issue 248)', () => {
  describe('Calendar Sync Settings Defaults & Constraints', () => {
    it('provides correct default calendar sync configuration', () => {
      expect(DEFAULT_CALENDAR_SYNC_SETTINGS).toEqual({
        syncEnabled: true,
        defaultDurationMinutes: 30,
        autoSyncCadenceTasks: true,
      });
    });

    it('clamps duration between 5 and 480 minutes', () => {
      function clampDuration(val: number): number {
        return Math.max(5, Math.min(480, Math.round(val)));
      }

      expect(clampDuration(2)).toBe(5);
      expect(clampDuration(0)).toBe(5);
      expect(clampDuration(-15)).toBe(5);
      expect(clampDuration(30)).toBe(30);
      expect(clampDuration(480)).toBe(480);
      expect(clampDuration(600)).toBe(480);
      expect(clampDuration(45.6)).toBe(46);
    });

    it('derives deterministic event IDs across retries', () => {
      const id1 = deriveCalendarEventId('step-1234-abcd');
      const id2 = deriveCalendarEventId('step-1234-abcd');
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[a-v0-9]{5,64}$/);
    });

    it('computes correct start and end times given duration', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const times = computeEventTimes(now, 45);
      expect(times.start).toBe('2026-10-17T10:00:00.000Z');
      expect(times.end).toBe('2026-10-17T10:45:00.000Z');
    });
  });

  describe('Email Engagement Analytics & Caveats', () => {
    it('provides tracking caveats disclosure text', () => {
      expect(TRACKING_CAVEATS_DISCLOSURE).toContain('probabilistic');
      expect(TRACKING_CAVEATS_DISCLOSURE).toContain("Display status is 'Opened', never 'Read'");
      expect(AUTO_OPENS_TIP).toContain('Auto-opens: pixel fetches from privacy proxies');
      expect(UNIQUE_RATE_TIP).toContain('unique recipients who engaged');
    });

    it('computes zero-state engagement rates safely when no logs exist', () => {
      const rates = computeEngagementRates([]);
      expect(rates.totalSentUnique).toBe(0);
      expect(rates.totalOpensUnique).toBe(0);
      expect(rates.uniqueOpenRate).toBe(0);
      expect(rates.uniqueClickRate).toBe(0);
      expect(rates.uniqueReplyRate).toBe(0);
      expect(rates.uniqueBounceRate).toBe(0);
    });

    it('computes accurate unique recipient rates across multiple events', () => {
      const logs: OutreachLogItem[] = [
        // Lead 1: Sent, Opened twice (should count as 1 unique open)
        {
          to: 'lead1@example.com',
          sentAt: '2026-10-17T09:00:00Z',
          openCount: 2,
          openedAt: '2026-10-17T09:05:00Z',
        },
        // Lead 2: Sent, Clicked and Replied
        {
          to: 'lead2@example.com',
          sentAt: '2026-10-17T09:10:00Z',
          clickedAt: '2026-10-17T09:15:00Z',
          repliedAt: '2026-10-17T09:20:00Z',
          replyClass: 'human',
        },
        // Lead 3: Sent, Bounced
        {
          to: 'lead3@example.com',
          sentAt: '2026-10-17T09:25:00Z',
          bouncedAt: '2026-10-17T09:26:00Z',
        },
        // Lead 4: Cancelled before send (should not count as sent)
        {
          to: 'lead4@example.com',
          cancelledAt: '2026-10-17T09:30:00Z',
        },
      ];

      const rates = computeEngagementRates(logs);
      expect(rates.totalSentUnique).toBe(3); // leads 1, 2, 3
      expect(rates.totalOpensUnique).toBe(1); // lead 1
      expect(rates.totalClicksUnique).toBe(1); // lead 2
      expect(rates.totalRepliesUnique).toBe(1); // lead 2
      expect(rates.totalBouncesUnique).toBe(1); // lead 3
      expect(rates.rawOpenCount).toBe(2);

      // Rates over 3 sent recipients are percentages out of 100
      expect(Math.round(rates.uniqueOpenRate)).toBe(33); // 1 / 3 = 33.3%
      expect(Math.round(rates.uniqueClickRate)).toBe(33); // 1 / 3 = 33.3%
      expect(Math.round(rates.uniqueReplyRate)).toBe(33); // 1 / 3 = 33.3%
      expect(Math.round(rates.uniqueBounceRate)).toBe(33); // 1 / 3 = 33.3%
    });
  });
});
