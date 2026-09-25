import type { SavedFilter } from '../../lib/saved-filters';

// Issue #214 — saved filters are now server-persisted per user/brand
// (lib/saved-filters-store.ts, app/api/saved-filters*), not primarily kept
// here anymore. This module survives narrowly as the one-time local-import
// migration source: app/components/FilterBar.tsx reads whatever a browser
// already has under this key to offer a self-serve "import to your
// account" action, and clears it only after a confirmed successful server
// import. Never written to as part of the normal save flow anymore.
function storageKey(brand: string): string {
  return `slg-saved-filters-${brand}`;
}

export function loadSavedFilters(brand: string): SavedFilter[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(brand));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedFilters(brand: string, filters: SavedFilter[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(brand), JSON.stringify(filters));
  } catch {
    // Quota exceeded or storage disabled — saved filters are a convenience,
    // not a feature anything else depends on, so this fails silently rather
    // than surfacing a notification for a non-critical persistence miss.
  }
}
