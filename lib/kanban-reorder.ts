// Same-column kanban reordering (issue #208) — pure decision/math logic,
// no Mongo, no React, so it's directly unit-testable (same convention as
// lib/kanban-column.ts/lib/stage-gate.ts).
//
// Columns are always fetched `.sort({ sortOrder: -1, createdAt: -1 })`
// (app/api/leads/columns/route.ts) — a HIGHER sortOrder renders higher
// (closer to the top) in the column. Every function below respects that
// descending convention.

export const NEEDS_RESEQUENCE = 'NEEDS_RESEQUENCE' as const;

// Deliberately large relative to legacy Date.now()-scale sortOrder values
// (COLUMN_MOVE has only ever written Date.now(), ~13 digits) so a freshly
// reordered lead never collides with a long, un-reordered stack of
// COLUMN_MOVE-only leads for a very long time.
const GAP = 1_000_000;
// float64 precision floor for repeated bisection between the same two
// neighbors.
const EPS = 1e-9;

// Fractional-indexing midpoint. `prevSortOrder`/`nextSortOrder` are the
// CURRENT sortOrder of the lead now immediately above/below the drop
// position — null means "no lead on that side" (dropped at the very
// top/bottom, or the column holds only this one lead).
export function computeReorderSortOrder(
  prevSortOrder: number | null,
  nextSortOrder: number | null
): number | typeof NEEDS_RESEQUENCE {
  if (prevSortOrder === null && nextSortOrder === null) {
    // Only lead in the column — matches the existing COLUMN_MOVE
    // "only item" convention (app/lib/lead-actions.ts).
    return Date.now();
  }
  if (prevSortOrder === null) {
    // Dropped at the very top — must sort above the current top item.
    return nextSortOrder! + GAP;
  }
  if (nextSortOrder === null) {
    // Dropped at the very bottom — must sort below the current bottom item.
    return prevSortOrder - GAP;
  }
  const mid = (prevSortOrder + nextSortOrder) / 2;
  if (mid === prevSortOrder || mid === nextSortOrder || (prevSortOrder - nextSortOrder) < EPS) {
    return NEEDS_RESEQUENCE;
  }
  return mid;
}

// Given the target column's current item-id order (as rendered, dragged
// item included) and the drop index GDS's onMoveItem reports, resolves
// which lead is now immediately above/below the dropped card — the
// `prevLeadId`/`nextLeadId` shape the COLUMN_REORDER payload contract uses.
// `toIndex` is the position within the list AFTER the dragged item is
// removed (standard sortable-list convention), so this removes it first.
export function resolveReorderNeighbors(
  itemIds: string[],
  draggedId: string,
  toIndex: number
): { prevLeadId: string | null; nextLeadId: string | null } {
  const withoutDragged = itemIds.filter((id) => id !== draggedId);
  const clampedIndex = Math.max(0, Math.min(toIndex, withoutDragged.length));
  return {
    prevLeadId: clampedIndex > 0 ? withoutDragged[clampedIndex - 1] : null,
    nextLeadId: clampedIndex < withoutDragged.length ? withoutDragged[clampedIndex] : null,
  };
}

export type MoveItemDecision = 'cross-column' | 'auto-managed-reject' | 'reorder';

// The three-way branch app/kanban.tsx's onMoveItem handler dispatches on,
// extracted as a pure function so it's unit-testable independent of the
// React component (matches this repo's established
// isVerticalScrollIntent()-style precedent for keeping decision logic out
// of the component itself).
export function decideMoveItemAction(
  fromColumnId: string,
  toColumnId: string,
  isTargetAutoManaged: boolean
): MoveItemDecision {
  if (fromColumnId !== toColumnId) return 'cross-column';
  if (isTargetAutoManaged) return 'auto-managed-reject';
  return 'reorder';
}
