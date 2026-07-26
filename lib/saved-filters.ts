// Issue #71 — saved/filtered views. Pure list-management logic, independent
// of where the list is actually persisted (app/lib/saved-filters-storage.ts
// wraps localStorage; kept separate so this stays unit-testable without a
// DOM/localStorage harness).

export type LeadFilter = {
  region?: string;
  industry?: string;
};

export type SavedFilter = {
  id: string;
  name: string;
  filter: LeadFilter;
};

export function isEmptyFilter(filter: LeadFilter): boolean {
  return !filter.region && !(filter.industry && filter.industry.trim());
}

const MAX_SAVED_FILTERS = 20;

export function addSavedFilter(
  existing: SavedFilter[],
  name: string,
  filter: LeadFilter,
  id: string
): SavedFilter[] {
  const trimmedName = name.trim();
  if (!trimmedName || isEmptyFilter(filter)) return existing;

  // A save under a name that already exists replaces that entry in place
  // (same position) rather than appending a duplicate-named second entry.
  const existingIndex = existing.findIndex((f) => f.name === trimmedName);
  if (existingIndex >= 0) {
    const next = existing.slice();
    next[existingIndex] = { id: existing[existingIndex].id, name: trimmedName, filter };
    return next;
  }

  const next = [...existing, { id, name: trimmedName, filter }];
  // Oldest dropped first if the cap is exceeded — a simple, predictable
  // bound rather than letting this grow unboundedly in localStorage.
  return next.length > MAX_SAVED_FILTERS ? next.slice(next.length - MAX_SAVED_FILTERS) : next;
}

export function removeSavedFilter(existing: SavedFilter[], id: string): SavedFilter[] {
  return existing.filter((f) => f.id !== id);
}
