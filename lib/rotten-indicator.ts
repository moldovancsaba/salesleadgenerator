// "Rotten" gradient indicator (issue #120) — a flat, always-visible day-count
// signal, distinct from lib/stale-deal.ts's per-column-threshold badge (which
// stays hidden until its own threshold, then fires binary stale/critical).
// The two coexist by design; this one never suppresses or replaces that one.
// No Date.now() inside — caller supplies `now`, mirroring stale-deal.ts.

export type RottenColumn = 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST' | 'BACKLOG';

export interface RottenIndicatorInput {
  kanbanColumn: RottenColumn;
  updatedAt?: string;
}

export interface RottenIndicatorResult {
  daysSince: number;
  level: 'green' | 'yellow' | 'red';
}

// Full red is reached at day 10, per the owner's explicit request — not
// per-column like lib/stale-deal.ts's thresholds (owner-confirmed decision:
// keep both indicators, this one flat across every active column).
const GREEN_MAX_DAYS = 3;
const YELLOW_MAX_DAYS = 7;

export function computeRottenLevel(lead: RottenIndicatorInput, now: Date): RottenIndicatorResult | null {
  // Issue #126 — a Backlog lead is deliberately parked, not neglected; this
  // indicator exists to flag active-pipeline leads going stale, which
  // doesn't apply to a lead nobody's meant to be touching right now.
  if (lead.kanbanColumn === 'WON' || lead.kanbanColumn === 'LOST' || lead.kanbanColumn === 'BACKLOG') return null;
  if (!lead.updatedAt) return null;

  const updated = new Date(lead.updatedAt);
  if (Number.isNaN(updated.getTime())) return null;

  const daysSince = Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
  if (daysSince < 0) return null;

  const level: RottenIndicatorResult['level'] =
    daysSince <= GREEN_MAX_DAYS ? 'green' : daysSince <= YELLOW_MAX_DAYS ? 'yellow' : 'red';

  return { daysSince, level };
}
