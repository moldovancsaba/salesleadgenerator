import { describe, it, expect } from 'vitest';
import { MANUAL_LEAD_DEFAULT_ICE } from '../../lib/create-lead-defaults';
import { QUALIFIED_ICE_THRESHOLD } from '../../lib/kanban-column';

describe('MANUAL_LEAD_DEFAULT_ICE', () => {
  it('is a valid 1-10 ICE triple', () => {
    expect(MANUAL_LEAD_DEFAULT_ICE.impact).toBeGreaterThanOrEqual(1);
    expect(MANUAL_LEAD_DEFAULT_ICE.impact).toBeLessThanOrEqual(10);
    expect(MANUAL_LEAD_DEFAULT_ICE.confidence).toBeGreaterThanOrEqual(1);
    expect(MANUAL_LEAD_DEFAULT_ICE.confidence).toBeLessThanOrEqual(10);
    expect(MANUAL_LEAD_DEFAULT_ICE.ease).toBeGreaterThanOrEqual(1);
    expect(MANUAL_LEAD_DEFAULT_ICE.ease).toBeLessThanOrEqual(10);
  });

  it('computes an ICE score comfortably under the QUALIFIED threshold, so a manually-added lead starts in DISCOVERED', () => {
    const score = MANUAL_LEAD_DEFAULT_ICE.impact * MANUAL_LEAD_DEFAULT_ICE.confidence * MANUAL_LEAD_DEFAULT_ICE.ease;
    expect(score).toBeLessThan(QUALIFIED_ICE_THRESHOLD);
  });
});
