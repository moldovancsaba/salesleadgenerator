// Desktop trackpad "natural scroll" fix: on wide/landscape layouts, GDS's
// KanbanBoard wraps its columns in a horizontally-scrolling Mantine
// ScrollArea (so the columns row can be panned sideways). A two-finger
// trackpad gesture almost never has a perfectly-zero horizontal delta, so a
// gesture the user experiences as "scroll the page down" can be captured by
// that horizontal container instead of chaining up to the page — the
// symptom is "scrolling doesn't work while my pointer is over a card."
//
// This only matters on desktop: on a touch device, GDS renders a stacked,
// single-column layout with no horizontal scroll container to fight in the
// first place (see useGdsKanbanOrientation in the vendored package), and
// native touch panning should never be intercepted by JS. The pointer-type
// gate in app/kanban.tsx's wiring keeps this fix out of that path entirely
// — this module is the pure, unit-testable predicate only.
//
// This app has no per-column internal vertical scroll of its own (every
// page relies on plain document/window scroll — see
// app/components/BackToTopButton.tsx's own comment on that), so a
// vertical-dominant wheel delta over the board always means "scroll the
// page," never "scroll something inside the board."
export function isVerticalScrollIntent(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaY) > Math.abs(deltaX);
}
