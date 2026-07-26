import type { SavedFilter } from '../../lib/saved-filters';

// Per-browser (localStorage), not server-persisted — owner-confirmed scope
// (issue #71): this app has no multi-device user-account concept to scope a
// shared version to, and localStorage ships faster for a feature whose
// value is still unproven.
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
