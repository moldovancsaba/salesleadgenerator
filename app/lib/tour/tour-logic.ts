// Issue #185 — pure, DOM-free logic split out of TourProvider.tsx
// specifically so it stays unit-testable without a browser/JSDOM, matching
// this repo's existing convention for pure business logic (e.g.
// lib/sso-access.ts's own "pure functions" section).

// The tour's first 3 steps only exist on the kanban board — auto-starting
// anywhere else (e.g. /forecast/[brand], where a fresh login actually
// lands per lib/sso-access.ts's resolveLoginDestination) would hit
// driver.js's own skipMissingElement fallback for every single step and
// self-destroy in the same tick, which shouldMarkSeen() below would then
// (correctly, but pointlessly) refuse to mark seen — better to simply never
// start in the first place.
const SALES_BOARD_PATH_RE = /^\/sales\/[^/]+\/?$/;

export function shouldAutoStartOnPath(pathname: string): boolean {
  return SALES_BOARD_PATH_RE.test(pathname);
}

// Guards the tour-completion API call, invoked from driver.js's
// onDestroyStarted hook. driver.js passes both `element` and `step` as
// undefined when it self-destroys without ever having highlighted anything
// (e.g. every step's target was missing) — that is not a real "the user saw
// the tour" event, and must never mark tourSeenAt, or a user who saw
// nothing would be permanently locked out of ever seeing the real tour.
export function shouldMarkSeen(element: unknown, step: unknown): boolean {
  return Boolean(element) && Boolean(step);
}

// sessionStorage key used when "Take the tour" (app/components/AppNav.tsx)
// is clicked from a page other than /sales/[brand] — the tour's steps 3+
// all chain off click events fired from steps 1-3's own targets, so
// replaying from a page where none of them exist would silently show
// nothing without first navigating to the sales board. TourProvider sets
// this before navigating, then consumes (and clears) it once it detects
// the resulting pathname change, bypassing the normal hasSeenTour gate for
// this one explicit, user-requested start.
export const TOUR_REQUEST_STORAGE_KEY = 'slg-tour-requested';
