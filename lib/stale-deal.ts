// Pure staleness calculation for kanban leads. No React, no Mongo, no
// Date.now() inside — the caller supplies `now` so results are deterministic
// and testable (mirrors lib/kanban-column-visibility.ts's shape).

export type KanbanColumn = 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST';

export const DEFAULT_STALE_THRESHOLDS: Record<KanbanColumn, number> = {
  DISCOVERED: 14,
  QUALIFIED: 14,
  ENGAGED: 21,
  PROPOSAL: 10,
  WON: 0,
  LOST: 0,
};

export interface StaleDealInput {
  kanbanColumn: KanbanColumn;
  updatedAt?: string;
}

export interface StaleDealResult {
  daysSince: number;
  thresholdDays: number;
  severity: 'stale' | 'critical';
}

export function computeStaleness(
  lead: StaleDealInput,
  thresholds: Partial<Record<KanbanColumn, number>>,
  now: Date
): StaleDealResult | null {
  if (lead.kanbanColumn === 'WON' || lead.kanbanColumn === 'LOST') return null;
  if (!lead.updatedAt) return null;

  const updated = new Date(lead.updatedAt);
  if (Number.isNaN(updated.getTime())) return null;

  const thresholdDays = thresholds[lead.kanbanColumn] ?? DEFAULT_STALE_THRESHOLDS[lead.kanbanColumn];
  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) return null;

  const daysSince = Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
  if (daysSince < thresholdDays) return null;

  return {
    daysSince,
    thresholdDays,
    severity: daysSince >= thresholdDays * 2 ? 'critical' : 'stale',
  };
}
