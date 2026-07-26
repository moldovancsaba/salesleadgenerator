import { describe, it, expect } from 'vitest';
import { correlateOutcomes } from '../../lib/outcome-correlation';

describe('correlateOutcomes', () => {
  it('computes a weighted won rate per industry above the sample-size threshold', () => {
    const logs = Array.from({ length: 10 }, (_, i) => ({
      leadId: `L${i}`,
      afterState: { kanbanColumn: i < 7 ? 'WON' : 'LOST' } as const,
      teachingWeight: 70,
    }));
    const industryById = new Map(logs.map((l) => [l.leadId, 'Sports Tech']));
    const result = correlateOutcomes(logs, industryById, null, 10);
    expect(result.byIndustry).toHaveLength(1);
    expect(result.byIndustry[0]).toEqual({ industry: 'Sports Tech', sampleSize: 10, weightedWonRate: 0.7 });
  });

  it('returns null weightedWonRate when below the minimum sample size', () => {
    const logs = [
      { leadId: 'L1', afterState: { kanbanColumn: 'WON' as const }, teachingWeight: 70 },
      { leadId: 'L2', afterState: { kanbanColumn: 'LOST' as const }, teachingWeight: 70 },
    ];
    const industryById = new Map([['L1', 'Academy'], ['L2', 'Academy']]);
    const result = correlateOutcomes(logs, industryById, null, 10);
    expect(result.byIndustry[0].sampleSize).toBe(2);
    expect(result.byIndustry[0].weightedWonRate).toBeNull();
  });

  it('weights a DECLINE-driven LOST more heavily than an implicit COLUMN_MOVE WON', () => {
    const won = Array.from({ length: 5 }, (_, i) => ({
      leadId: `W${i}`,
      afterState: { kanbanColumn: 'WON' as 'WON' | 'LOST' },
      teachingWeight: 70, // implicit COLUMN_MOVE
    }));
    const lost = Array.from({ length: 5 }, (_, i) => ({
      leadId: `L${i}`,
      afterState: { kanbanColumn: 'LOST' as 'WON' | 'LOST' },
      teachingWeight: 100, // explicit DECLINE
    }));
    const logs = [...won, ...lost];
    const industryById = new Map(logs.map((l) => [l.leadId, 'Federation']));
    const result = correlateOutcomes(logs, industryById, null, 10);
    // wonWeight = 5*70 = 350, totalWeight = 5*70 + 5*100 = 850
    expect(result.byIndustry[0].weightedWonRate).toBeCloseTo(350 / 850, 5);
  });

  it('buckets leads with no industry set into Unknown', () => {
    const logs = Array.from({ length: 10 }, (_, i) => ({
      leadId: `L${i}`,
      afterState: { kanbanColumn: 'WON' as const },
      teachingWeight: 70,
    }));
    const industryById = new Map<string, string | undefined>();
    const result = correlateOutcomes(logs, industryById, null, 10);
    expect(result.byIndustry[0].industry).toBe('Unknown');
  });

  it('ignores non-terminal outcome log entries', () => {
    const logs = [
      { leadId: 'L1', afterState: { kanbanColumn: 'ENGAGED' as const }, teachingWeight: 70 },
      { leadId: 'L1', afterState: { kanbanColumn: 'PROPOSAL' as const }, teachingWeight: 70 },
    ];
    const industryById = new Map([['L1', 'Academy']]);
    const result = correlateOutcomes(logs, industryById, null, 10);
    expect(result.byIndustry).toHaveLength(0);
  });

  it('computes accept rate per search query above the sample-size threshold', () => {
    const queries = [{ query: 'youth sports academy', accepted: 8, declined: 2 }];
    const result = correlateOutcomes([], new Map(), queries, 10);
    expect(result.bySearchQuery[0]).toEqual({ query: 'youth sports academy', sampleSize: 10, acceptRate: 0.8 });
  });

  it('returns null acceptRate for a thin search query and handles a null searchQueries input', () => {
    const queries = [{ query: 'niche term', accepted: 1, declined: 0 }];
    const result = correlateOutcomes([], new Map(), queries, 10);
    expect(result.bySearchQuery[0].acceptRate).toBeNull();

    const emptyResult = correlateOutcomes([], new Map(), null, 10);
    expect(emptyResult.bySearchQuery).toEqual([]);
  });
});
