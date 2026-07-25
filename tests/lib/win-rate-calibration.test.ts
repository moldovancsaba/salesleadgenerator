import { describe, it, expect } from 'vitest';
import {
  computeWinRatesFromLogs,
  mergeCalibratedWeights,
  DEFAULT_MIN_SAMPLE_SIZE,
} from '../../lib/win-rate-calibration';
import type { OutcomeLogEntry, WinRateStats } from '../../lib/win-rate-calibration';

// Tenant isolation (a leadId's outcomelogs from tenant A never leaking into
// tenant B's computed rates) is enforced by app/lib/win-rate-store.ts's
// fetchOutcomeLogs() at the Mongo query layer (lib/tenant.ts's tenantFilter),
// not inside this pure function — untestable here without a live/in-memory
// Mongo, which this sandbox cannot provision (mongodb-memory-server's binary
// download is blocked by this sandbox's network policy, the same documented
// gap as tests/integration/health.integration.test.ts). Likewise, the
// app/api/leads/[id]/route.ts PUT-handler fix (writing an outcomelogs entry
// on a kanbanColumn change) is a route-level change verified by code review
// against the identical pattern app/lib/lead-actions.ts already uses, not by
// an automated test here, for the same reason.

function entry(leadId: string, before: string | undefined, after: string, createdAt: string): OutcomeLogEntry {
  return {
    leadId,
    createdAt,
    beforeState: before ? { kanbanColumn: before } : {},
    afterState: { kanbanColumn: after },
  };
}

describe('computeWinRatesFromLogs', () => {
  it('computes an exact known win rate per stage from synthetic logs', () => {
    const logs: OutcomeLogEntry[] = [
      // lead-1: DISCOVERED -> QUALIFIED -> WON (visits DISCOVERED, QUALIFIED)
      entry('lead-1', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'DISCOVERED', 'QUALIFIED', '2026-01-02T00:00:00Z'),
      entry('lead-1', 'QUALIFIED', 'WON', '2026-01-03T00:00:00Z'),
      // lead-2: DISCOVERED -> QUALIFIED -> LOST (visits DISCOVERED, QUALIFIED)
      entry('lead-2', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-2', 'DISCOVERED', 'QUALIFIED', '2026-01-02T00:00:00Z'),
      entry('lead-2', 'QUALIFIED', 'LOST', '2026-01-03T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 1);
    expect(stats.DISCOVERED).toMatchObject({ sampleSize: 2, wonCount: 1, lostCount: 1, rate: 0.5, confidence: 'ok' });
    expect(stats.QUALIFIED).toMatchObject({ sampleSize: 2, wonCount: 1, lostCount: 1, rate: 0.5, confidence: 'ok' });
    expect(stats.ENGAGED).toMatchObject({ sampleSize: 0 });
    expect(stats.PROPOSAL).toMatchObject({ sampleSize: 0 });
  });

  it('falls back to the static default with confidence "insufficient" for a zero-sample stage', () => {
    const stats = computeWinRatesFromLogs([], DEFAULT_MIN_SAMPLE_SIZE, { PROPOSAL: 0.25 });
    expect(stats.PROPOSAL).toMatchObject({ sampleSize: 0, wonCount: 0, lostCount: 0, rate: 0.25, confidence: 'insufficient' });
  });

  it('returns a real rate below minSampleSize, only flagging confidence as insufficient', () => {
    const logs: OutcomeLogEntry[] = [
      entry('lead-1', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'DISCOVERED', 'WON', '2026-01-02T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 20);
    expect(stats.DISCOVERED).toMatchObject({ sampleSize: 1, wonCount: 1, rate: 1, confidence: 'insufficient' });
  });

  it('attributes a lead that skips stages only to the stage it actually departed from', () => {
    // DISCOVERED -> WON in a single COLUMN_MOVE: only DISCOVERED gets credited,
    // never QUALIFIED/ENGAGED/PROPOSAL which this lead never visited.
    const logs: OutcomeLogEntry[] = [
      entry('lead-1', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'DISCOVERED', 'WON', '2026-01-02T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 1);
    expect(stats.DISCOVERED).toMatchObject({ sampleSize: 1, wonCount: 1 });
    expect(stats.QUALIFIED.sampleSize).toBe(0);
    expect(stats.ENGAGED.sampleSize).toBe(0);
    expect(stats.PROPOSAL.sampleSize).toBe(0);
  });

  it('excludes a lead with no WON/LOST terminal state from every denominator', () => {
    const logs: OutcomeLogEntry[] = [
      entry('lead-1', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'DISCOVERED', 'QUALIFIED', '2026-01-02T00:00:00Z'),
      entry('lead-1', 'QUALIFIED', 'ENGAGED', '2026-01-03T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 1);
    expect(stats.DISCOVERED.sampleSize).toBe(0);
    expect(stats.QUALIFIED.sampleSize).toBe(0);
  });

  it('filters out no-op transitions (beforeState === afterState) before path reconstruction', () => {
    const logs: OutcomeLogEntry[] = [
      entry('lead-1', undefined, 'DISCOVERED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'DISCOVERED', 'DISCOVERED', '2026-01-01T12:00:00Z'), // no-op MODIFY
      entry('lead-1', 'DISCOVERED', 'WON', '2026-01-02T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 1);
    expect(stats.DISCOVERED).toMatchObject({ sampleSize: 1, wonCount: 1 });
  });

  it('returns all-zero sample sizes for a brand-new tenant with zero outcomelogs, never throwing', () => {
    expect(() => computeWinRatesFromLogs([])).not.toThrow();
    const stats = computeWinRatesFromLogs([]);
    for (const stage of Object.keys(stats) as (keyof WinRateStats)[]) {
      expect(stats[stage].sampleSize).toBe(0);
      expect(stats[stage].confidence).toBe('insufficient');
      expect(Number.isFinite(stats[stage].rate)).toBe(true);
    }
  });

  it('computes an exact 0.5 rate for a 50/50 split, never NaN or divide-by-zero', () => {
    const logs: OutcomeLogEntry[] = [
      entry('lead-1', undefined, 'ENGAGED', '2026-01-01T00:00:00Z'),
      entry('lead-1', 'ENGAGED', 'WON', '2026-01-02T00:00:00Z'),
      entry('lead-2', undefined, 'ENGAGED', '2026-01-01T00:00:00Z'),
      entry('lead-2', 'ENGAGED', 'LOST', '2026-01-02T00:00:00Z'),
    ];
    const stats = computeWinRatesFromLogs(logs, 1);
    expect(stats.ENGAGED.rate).toBe(0.5);
    expect(Number.isNaN(stats.ENGAGED.rate)).toBe(false);
  });

  it('ignores entries with no leadId or no afterState.kanbanColumn rather than throwing', () => {
    const logs: any[] = [
      { leadId: '', createdAt: '2026-01-01T00:00:00Z', beforeState: {}, afterState: { kanbanColumn: 'WON' } },
      { leadId: 'lead-1', createdAt: '2026-01-01T00:00:00Z', beforeState: { kanbanColumn: 'DISCOVERED' }, afterState: {} },
    ];
    expect(() => computeWinRatesFromLogs(logs, 1)).not.toThrow();
  });
});

describe('mergeCalibratedWeights', () => {
  const staticWeights = { DISCOVERED: 0.01, QUALIFIED: 0.05, ENGAGED: 0.1, PROPOSAL: 0.25, WON: 1, LOST: 0 };

  function stat(sampleSize: number, rate: number, confidence: 'ok' | 'insufficient'): { sampleSize: number; wonCount: number; lostCount: number; rate: number; confidence: 'ok' | 'insufficient' } {
    return { sampleSize, wonCount: Math.round(sampleSize * rate), lostCount: sampleSize - Math.round(sampleSize * rate), rate, confidence };
  }

  it('in static mode, returns the static weights unchanged with every source "static" (regression: byte-identical to pre-calibration output)', () => {
    const cached: WinRateStats = {
      DISCOVERED: stat(50, 0.4, 'ok'),
      QUALIFIED: stat(50, 0.4, 'ok'),
      ENGAGED: stat(50, 0.4, 'ok'),
      PROPOSAL: stat(50, 0.4, 'ok'),
    };
    const result = mergeCalibratedWeights(staticWeights, cached, 'static', 20);
    expect(result.weightsUsed).toEqual(staticWeights);
    expect(Object.values(result.sources).every((s) => s === 'static')).toBe(true);
  });

  it('in calibrated mode with a fresh cached doc, substitutes only sufficiently-sampled stages', () => {
    const cached: WinRateStats = {
      DISCOVERED: stat(50, 0.4, 'ok'),
      QUALIFIED: stat(5, 0.9, 'insufficient'),
      ENGAGED: stat(30, 0.6, 'ok'),
      PROPOSAL: stat(0, 0.25, 'insufficient'),
    };
    const result = mergeCalibratedWeights(staticWeights, cached, 'calibrated', 20);
    expect(result.weightsUsed.DISCOVERED).toBe(0.4);
    expect(result.sources.DISCOVERED).toBe('calibrated');
    expect(result.weightsUsed.ENGAGED).toBe(0.6);
    expect(result.sources.ENGAGED).toBe('calibrated');
    // Below minSampleSize (or confidence: insufficient) -> static default kept, not overridden.
    expect(result.weightsUsed.QUALIFIED).toBe(staticWeights.QUALIFIED);
    expect(result.sources.QUALIFIED).toBe('static');
    expect(result.weightsUsed.PROPOSAL).toBe(staticWeights.PROPOSAL);
    expect(result.sources.PROPOSAL).toBe('static');
    // WON/LOST are never calibratable stages.
    expect(result.weightsUsed.WON).toBe(1);
    expect(result.weightsUsed.LOST).toBe(0);
  });

  it('falls back to static weights when calibrated mode has no cached doc yet', () => {
    const result = mergeCalibratedWeights(staticWeights, null, 'calibrated', 20);
    expect(result.weightsUsed).toEqual(staticWeights);
    expect(Object.values(result.sources).every((s) => s === 'static')).toBe(true);
  });
});
