// Desktop trackpad and wheel "natural scroll" fix: on wide/landscape layouts,
// GDS's KanbanBoard wraps its columns in a horizontally-scrolling Mantine
// ScrollArea (so the columns row can be panned sideways). A two-finger
// trackpad gesture or mouse-wheel action over a card can be captured by that
// horizontal container instead of chaining up to the window/document — the
// symptom is "vertical scrolling doesn't work while hovering over the kanban board in Chrome."
//
// This only applies on desktop: on touchscreens, GDS renders a stacked layout
// or handles touch panning natively. The pointer-type gate in app/kanban.tsx's
// wiring keeps this fix out of touch devices entirely.
//
// This app has no per-column internal vertical scroll of its own (every page
// relies on plain document/window scroll), so a vertical-dominant wheel delta
// over the board always means "scroll the page," never "scroll inside the board."
export function isVerticalScrollIntent(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaY) > Math.abs(deltaX);
}
