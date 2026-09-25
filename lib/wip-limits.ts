// WIP-limit visual cue (issue #213) — a purely additive, non-blocking
// caution badge on a kanban column header once its lead count exceeds a
// configurable per-column threshold. Never blocks COLUMN_MOVE/add — visual
// only. Mirrors lib/stale-deal.ts's DEFAULT_STALE_THRESHOLDS shape and the
// same Record<KanbanColumn, number>-per-`settings` collection convention
// app/api/settings/route.ts already established for pipeline_weights/
// stale_thresholds.

export type KanbanColumnKey = 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST' | 'BACKLOG';

// A column with 0 (or no entry) never shows the cue — same "0 disables it"
// convention DEFAULT_STALE_THRESHOLDS already uses for WON/LOST/BACKLOG.
// Higher defaults for the auto-managed, high-volume top-of-funnel columns
// (DISCOVERED/QUALIFIED) than the manually-worked ones (ENGAGED/PROPOSAL),
// per issue #213 §13's own guidance.
export const DEFAULT_WIP_LIMITS: Record<KanbanColumnKey, number> = {
  DISCOVERED: 60,
  QUALIFIED: 40,
  ENGAGED: 20,
  PROPOSAL: 15,
  WON: 0,
  LOST: 0,
  BACKLOG: 0,
};

export function resolveWipThreshold(column: string, configured?: Record<string, number> | null): number | undefined {
  const value = configured?.[column] ?? DEFAULT_WIP_LIMITS[column as KanbanColumnKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// A threshold of 0 (or unset) disables the cue for that column entirely —
// never triggers on an empty/near-empty column by accident (issue #213 §15).
export function isOverWipLimit(count: number, threshold: number | undefined): boolean {
  return typeof threshold === 'number' && threshold > 0 && count > threshold;
}
