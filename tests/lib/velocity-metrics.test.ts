import { describe, it, expect } from 'vitest';
import { computeVelocity } from '../../app/lib/velocity-metrics';

const NOW = new Date('2026-07-25T00:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe('computeVelocity', () => {
  it('detects a transition from a COLUMN_MOVE-shaped log, falling back to leadCreatedAt for the first hop', () => {
    const result = computeVelocity(
      [{ leadId: 'lead1', createdAt: daysAgo(9), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } }],
      { lead1: daysAgo(18) },
      NOW
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ from: 'DISCOVERED', to: 'QUALIFIED', sampleSize: 1, avgDays: 9, medianDays: 9 });
  });

  it('detects a transition from a PIN-shaped log (from a prior stage straight to ENGAGED) — detection is not action-type-gated', () => {
    const result = computeVelocity(
      [
        { leadId: 'lead2', createdAt: daysAgo(20), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
        { leadId: 'lead2', createdAt: daysAgo(15), beforeState: { kanbanColumn: 'QUALIFIED' }, afterState: { kanbanColumn: 'ENGAGED' } },
      ],
      { lead2: daysAgo(25) },
      NOW
    );
    const pinTransition = result.transitions.find((t) => t.from === 'QUALIFIED' && t.to === 'ENGAGED');
    expect(pinTransition).toMatchObject({ sampleSize: 1, avgDays: 5 }); // origin = the prior transition's own timestamp, not leadCreatedAt
  });

  it('detects a DECLINE-shaped log straight from DISCOVERED to LOST', () => {
    const result = computeVelocity(
      [{ leadId: 'lead3', createdAt: daysAgo(2), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'LOST' } }],
      { lead3: daysAgo(6) },
      NOW
    );
    expect(result.transitions).toEqual([
      expect.objectContaining({ from: 'DISCOVERED', to: 'LOST', sampleSize: 1, avgDays: 4 }),
    ]);
  });

  it('ignores non-column-changing logs (e.g. MODIFY) without crashing', () => {
    const result = computeVelocity(
      [{ leadId: 'lead4', createdAt: daysAgo(1), beforeState: { kanbanColumn: 'ENGAGED' }, afterState: { kanbanColumn: 'ENGAGED' } }],
      { lead4: daysAgo(10) },
      NOW
    );
    expect(result.transitions).toEqual([]);
  });

  it('counts a bouncing lead\'s repeated transitions as independent samples', () => {
    const result = computeVelocity(
      [
        { leadId: 'lead5', createdAt: daysAgo(20), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
        { leadId: 'lead5', createdAt: daysAgo(15), beforeState: { kanbanColumn: 'QUALIFIED' }, afterState: { kanbanColumn: 'DISCOVERED' } },
        { leadId: 'lead5', createdAt: daysAgo(10), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
      ],
      { lead5: daysAgo(25) },
      NOW
    );
    const discoveredToQualified = result.transitions.find((t) => t.from === 'DISCOVERED' && t.to === 'QUALIFIED');
    expect(discoveredToQualified?.sampleSize).toBe(2);
  });

  it('excludes a duration for a sparse pre-feature lead with no known origin (from !== DISCOVERED, no prior transition, no leadCreatedAt entry)', () => {
    const result = computeVelocity(
      [{ leadId: 'lead6', createdAt: daysAgo(3), beforeState: { kanbanColumn: 'QUALIFIED' }, afterState: { kanbanColumn: 'ENGAGED' } }],
      {},
      NOW
    );
    expect(result.transitions[0]).toMatchObject({ sampleSize: 0, avgDays: null, medianDays: null });
  });

  it('handles an empty outcomelogs array with no divide-by-zero', () => {
    const result = computeVelocity([], {}, NOW);
    expect(result.transitions).toEqual([]);
    expect(result.avgTimeInStage).toEqual({});
    expect(result.insufficientData).toBe(true);
  });

  it('returns a null trendPct (not NaN/Infinity) when there is no prior-period sample', () => {
    const result = computeVelocity(
      [{ leadId: 'lead7', createdAt: daysAgo(2), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } }],
      { lead7: daysAgo(5) },
      NOW
    );
    expect(result.transitions[0].priorPeriodAvgDays).toBeNull();
    expect(result.transitions[0].trendPct).toBeNull();
  });

  it('computes a correct trendPct when both current and prior-period samples exist', () => {
    const result = computeVelocity(
      [
        // Prior period (31-60 days ago): 10-day transition.
        { leadId: 'leadA', createdAt: daysAgo(50), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
        // Current period (0-30 days ago): 5-day transition — twice as fast.
        { leadId: 'leadB', createdAt: daysAgo(5), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
      ],
      { leadA: daysAgo(60), leadB: daysAgo(10) },
      NOW
    );
    const stat = result.transitions.find((t) => t.from === 'DISCOVERED' && t.to === 'QUALIFIED');
    expect(stat?.avgDays).toBe(5);
    expect(stat?.priorPeriodAvgDays).toBe(10);
    expect(stat?.trendPct).toBe(-50);
  });

  it('aggregates avgTimeInStage by origin stage across every destination', () => {
    const result = computeVelocity(
      [
        { leadId: 'leadX', createdAt: daysAgo(10), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } },
        { leadId: 'leadY', createdAt: daysAgo(5), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'LOST' } },
      ],
      { leadX: daysAgo(20), leadY: daysAgo(15) },
      NOW
    );
    // leadX: 20->10 = 10 days; leadY: 15->5 = 10 days. Both originate from DISCOVERED.
    expect(result.avgTimeInStage.DISCOVERED).toBe(10);
  });

  it('flags insufficientData below the sample floor and clears it once enough current-period samples exist', () => {
    const sparse = computeVelocity(
      [{ leadId: 'lead8', createdAt: daysAgo(1), beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: { kanbanColumn: 'QUALIFIED' } }],
      { lead8: daysAgo(2) },
      NOW
    );
    expect(sparse.insufficientData).toBe(true);

    const logs = Array.from({ length: 5 }, (_, i) => ({
      leadId: `lead${i}`,
      createdAt: daysAgo(1),
      beforeState: { kanbanColumn: 'DISCOVERED' },
      afterState: { kanbanColumn: 'QUALIFIED' },
    }));
    const leadCreatedAt = Object.fromEntries(logs.map((l) => [l.leadId, daysAgo(2)]));
    const sufficient = computeVelocity(logs, leadCreatedAt, NOW);
    expect(sufficient.insufficientData).toBe(false);
  });
});
