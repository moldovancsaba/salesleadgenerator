import { describe, it, expect } from 'vitest';
import { computeRottenLevel } from '../../lib/rotten-indicator';

const NOW = new Date('2026-07-27T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('computeRottenLevel', () => {
  it('returns null for WON/LOST columns', () => {
    expect(computeRottenLevel({ kanbanColumn: 'WON', updatedAt: daysAgo(15) }, NOW)).toBeNull();
    expect(computeRottenLevel({ kanbanColumn: 'LOST', updatedAt: daysAgo(15) }, NOW)).toBeNull();
  });

  it('returns null for a missing updatedAt', () => {
    expect(computeRottenLevel({ kanbanColumn: 'ENGAGED' }, NOW)).toBeNull();
  });

  it('returns null for an invalid updatedAt', () => {
    expect(computeRottenLevel({ kanbanColumn: 'ENGAGED', updatedAt: 'not-a-date' }, NOW)).toBeNull();
  });

  it('returns null for a future updatedAt (clock skew)', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(computeRottenLevel({ kanbanColumn: 'ENGAGED', updatedAt: future }, NOW)).toBeNull();
  });

  it('is green at day 0', () => {
    const result = computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(0) }, NOW);
    expect(result).toEqual({ daysSince: 0, level: 'green' });
  });

  it('is green through day 3', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(3) }, NOW)?.level).toBe('green');
  });

  it('is yellow at day 4', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(4) }, NOW)?.level).toBe('yellow');
  });

  it('is yellow through day 7', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(7) }, NOW)?.level).toBe('yellow');
  });

  it('is red at day 8', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(8) }, NOW)?.level).toBe('red');
  });

  it('reaches full red by day 10 (never later)', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(10) }, NOW)?.level).toBe('red');
  });

  it('stays red well past day 10', () => {
    expect(computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(90) }, NOW)?.level).toBe('red');
  });

  it('applies the same flat scale regardless of column', () => {
    const discovered = computeRottenLevel({ kanbanColumn: 'DISCOVERED', updatedAt: daysAgo(5) }, NOW);
    const proposal = computeRottenLevel({ kanbanColumn: 'PROPOSAL', updatedAt: daysAgo(5) }, NOW);
    expect(discovered?.level).toBe(proposal?.level);
  });
});
