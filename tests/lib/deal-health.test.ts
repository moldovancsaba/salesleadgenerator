import { describe, it, expect } from 'vitest';
import { computeDealHealth } from '../../lib/deal-health';

describe('computeDealHealth (issue 280)', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');

  it('returns 100 for WON deals and 0 for LOST deals', () => {
    const won = computeDealHealth({ kanbanColumn: 'WON' }, now);
    expect(won.score).toBe(100);
    expect(won.tier).toBe('healthy');

    const lost = computeDealHealth({ kanbanColumn: 'LOST' }, now);
    expect(lost.score).toBe(0);
    expect(lost.tier).toBe('critical');
  });

  it('scores a well-worked deal as healthy (>= 70)', () => {
    const healthy = computeDealHealth(
      {
        kanbanColumn: 'PROPOSAL',
        updatedAt: '2026-10-22T12:00:00.000Z',
        ice: { impact: 9, confidence: 9, ease: 9 },
        qualityStatus: 'VERIFIED',
        contacts: [
          {
            name: 'Paolo Maldini',
            email: 'paolo@acmilan.com',
            emailVerificationStatus: 'valid',
            buyingRole: 'economic_buyer',
          },
        ],
        nextActionDueAt: '2026-10-28T12:00:00.000Z',
        deals: [
          {
            id: 'd1',
            value: 35000,
            currency: 'EUR',
            createdAt: '',
            updatedAt: '',
            source: 'manual',
          },
        ],
        qualification: {
          budgetConfirmed: true,
          authorityConfirmed: true,
          needNotes: 'Matchday fan engagement',
          timelineEstimate: 'Q4',
        },
      },
      now
    );

    expect(healthy.score).toBeGreaterThanOrEqual(85);
    expect(healthy.tier).toBe('healthy');
    expect(healthy.factors).toHaveLength(5);
  });

  it('scores a neglected deal with no contacts or deal value as critical (< 40)', () => {
    const neglected = computeDealHealth(
      {
        kanbanColumn: 'PROPOSAL',
        updatedAt: '2026-09-01T12:00:00.000Z', // > 50 days stale
        ice: { impact: 2, confidence: 2, ease: 2 },
        qualityStatus: 'DRAFT',
        contacts: [],
      },
      now
    );

    expect(neglected.score).toBeLessThan(40);
    expect(neglected.tier).toBe('critical');
  });
});
