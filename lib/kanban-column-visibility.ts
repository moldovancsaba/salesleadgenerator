// GDS's KanbanColumn renders header and cards as one opaque unit (no header
// render-prop), so an in-place "tap the header to collapse" accordion isn't
// buildable without reimplementing GDS's own governed column chrome. This
// toggles whole columns in/out of the board instead — same PWA navigation
// win (fewer visible columns, less horizontal scroll), entirely in-app.
export function toggleColumnVisibility<T extends string>(
  hidden: Set<T>,
  key: T,
  totalColumns: number
): Set<T> {
  const next = new Set(hidden);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  // Always leave at least one column visible.
  if (hidden.size >= totalColumns - 1) return hidden;
  next.add(key);
  return next;
}
