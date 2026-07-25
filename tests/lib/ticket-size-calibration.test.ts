import { describe, it, expect } from 'vitest';
import { computeTicketSizeCalibration } from '../../lib/ticket-size-calibration';
import type { WonLeadForCalibration } from '../../lib/ticket-size-calibration';

function won(size: string, method: 'tier_band' | 'per_unit' | 'unconfigured', expected: number | undefined, actual: number | undefined): WonLeadForCalibration {
  return { size, ticketSizeEstimate: { method, expected }, actualDealValueUsd: actual };
}

describe('computeTicketSizeCalibration', () => {
  it('computes exact known mean/median absolute and percent error for a single group', () => {
    const leads = [
      won('Medium', 'tier_band', 40000, 50000), // error +10000, +25%
      won('Medium', 'tier_band', 40000, 30000), // error -10000, -25%
      won('Medium', 'tier_band', 40000, 44000), // error +4000, +10%
    ];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.tier).toBe('Medium');
    expect(g.method).toBe('tier_band');
    expect(g.sampleSize).toBe(3);
    expect(g.meanAbsoluteError).toBe(Math.round((10000 + 10000 + 4000) / 3));
    expect(g.medianAbsoluteError).toBe(10000);
    expect(g.meanPercentError).toBeCloseTo((25 - 25 + 10) / 3, 1);
  });

  it('groups separately by tier and by method, never mixing them', () => {
    const leads = [
      won('Small', 'tier_band', 5000, 5000),
      won('Small', 'per_unit', 12000, 12000),
      won('Large', 'tier_band', 100000, 100000),
    ];
    const result = computeTicketSizeCalibration(leads, 1);
    const keys = result.groups.map((g) => `${g.tier}:${g.method}`).sort();
    expect(keys).toEqual(['Large:tier_band', 'Small:per_unit', 'Small:tier_band']);
  });

  it('gates confidence on the minimum sample size', () => {
    const leads = [won('Small', 'tier_band', 5000, 5000), won('Small', 'tier_band', 5000, 6000)];
    const result = computeTicketSizeCalibration(leads, 5);
    expect(result.groups[0].confidence).toBe('insufficient');

    const enough = computeTicketSizeCalibration(leads, 2);
    expect(enough.groups[0].confidence).toBe('ok');
  });

  it('excludes a WON lead whose estimate was unconfigured, counting it separately', () => {
    const leads = [won('Small', 'unconfigured', undefined, 5000)];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups).toHaveLength(0);
    expect(result.wonWithoutEstimate).toBe(1);
    expect(result.wonWithoutActual).toBe(0);
  });

  it('excludes a WON lead with a real estimate but no actualDealValueUsd captured, counting it separately', () => {
    const leads = [won('Small', 'tier_band', 5000, undefined)];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups).toHaveLength(0);
    expect(result.wonWithoutEstimate).toBe(0);
    expect(result.wonWithoutActual).toBe(1);
  });

  it('never fabricates a $0 actual for a lead that never had one set', () => {
    const leads = [won('Small', 'tier_band', 5000, undefined), won('Small', 'tier_band', 5000, 5500)];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups[0].sampleSize).toBe(1); // only the lead with a real actual counts
    expect(result.wonWithoutActual).toBe(1);
  });

  it('buckets a lead with no recognized size tier as "Unknown" rather than throwing', () => {
    const leads = [won('', 'tier_band', 5000, 5000)];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups[0].tier).toBe('Unknown');
  });

  it('a negative mean percent error signals systematic overestimation', () => {
    const leads = [won('Large', 'tier_band', 100000, 60000), won('Large', 'tier_band', 100000, 70000)];
    const result = computeTicketSizeCalibration(leads, 1);
    expect(result.groups[0].meanPercentError).toBeLessThan(0);
  });

  it('returns an empty result for no won leads at all, never throwing', () => {
    const result = computeTicketSizeCalibration([], 1);
    expect(result.groups).toEqual([]);
    expect(result.wonWithoutEstimate).toBe(0);
    expect(result.wonWithoutActual).toBe(0);
  });
});
