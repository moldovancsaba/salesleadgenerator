import { describe, it, expect } from 'vitest';
import {
  getLeadEffectiveValue,
  isLeadNeedsFollowUp,
  matchesQuickFilterPreset,
  HIGH_VALUE_THRESHOLD_EUR,
} from '../../lib/quick-filter-presets';

describe('quick-filter-presets (Issue 273)', () => {
  describe('getLeadEffectiveValue', () => {
    it('sums active deals when present', () => {
      const lead: any = {
        deals: [
          { id: 'd1', title: 'Deal 1', value: 15000, stage: 'PROPOSAL' },
          { id: 'd2', title: 'Deal 2', value: 12000, stage: 'QUALIFIED' },
          { id: 'd3', title: 'Lost Deal', value: 50000, stage: 'LOST' },
        ],
      };
      expect(getLeadEffectiveValue(lead)).toBe(27000);
    });

    it('falls back to ticketSizeEstimate.expected when no active deals exist', () => {
      const lead: any = {
        ticketSizeEstimate: {
          low: 10000,
          expected: 30000,
          high: 50000,
          currency: 'EUR',
          confidence: 'medium',
          method: 'tier_band',
        },
      };
      expect(getLeadEffectiveValue(lead)).toBe(30000);
    });

    it('returns 0 when neither deals nor ticket size are set', () => {
      expect(getLeadEffectiveValue({})).toBe(0);
    });
  });

  describe('isLeadNeedsFollowUp', () => {
    it('returns true for past or same-day nextActionDueAt', () => {
      const now = new Date('2026-10-22T12:00:00Z').getTime();
      expect(isLeadNeedsFollowUp({ nextActionDueAt: '2026-10-20T09:00:00Z' } as any, now)).toBe(true);
      expect(isLeadNeedsFollowUp({ nextActionDueAt: '2026-10-22T18:00:00Z' } as any, now)).toBe(true);
    });

    it('returns false for future dates or missing nextActionDueAt', () => {
      const now = new Date('2026-10-22T12:00:00Z').getTime();
      expect(isLeadNeedsFollowUp({ nextActionDueAt: '2026-10-25T09:00:00Z' } as any, now)).toBe(false);
      expect(isLeadNeedsFollowUp({}, now)).toBe(false);
    });
  });

  describe('matchesQuickFilterPreset', () => {
    it('matches all leads for preset all', () => {
      expect(matchesQuickFilterPreset({}, 'all')).toBe(true);
    });

    it('matches unassigned leads accurately', () => {
      expect(matchesQuickFilterPreset({ assignedTo: null }, 'unassigned')).toBe(true);
      expect(matchesQuickFilterPreset({ assignedTo: 'user-1' }, 'unassigned')).toBe(false);
    });

    it('matches my_leads by userId or userEmail', () => {
      expect(
        matchesQuickFilterPreset(
          { assignedTo: 'u-123' },
          'my_leads',
          { currentUserId: 'u-123', currentUserEmail: 'rep@sso.local' }
        )
      ).toBe(true);
      expect(
        matchesQuickFilterPreset(
          { assignedToEmail: 'rep@sso.local' } as any,
          'my_leads',
          { currentUserId: 'u-999', currentUserEmail: 'REP@sso.local' }
        )
      ).toBe(true);
      expect(
        matchesQuickFilterPreset(
          { assignedTo: 'u-other' },
          'my_leads',
          { currentUserId: 'u-123' }
        )
      ).toBe(false);
    });

    it('matches high_value leads above HIGH_VALUE_THRESHOLD_EUR', () => {
      const highLead: any = {
        deals: [{ id: '1', value: HIGH_VALUE_THRESHOLD_EUR, stage: 'ENGAGED' }],
      };
      const lowLead: any = {
        deals: [{ id: '2', value: 5000, stage: 'ENGAGED' }],
      };
      expect(matchesQuickFilterPreset(highLead, 'high_value')).toBe(true);
      expect(matchesQuickFilterPreset(lowLead, 'high_value')).toBe(false);
    });
  });
});
