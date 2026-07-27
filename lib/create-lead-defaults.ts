// Manual lead creation (issue #127) — POST /api/leads requires a full
// ice:{impact,confidence,ease} object on create, but the Add Lead form
// deliberately doesn't ask a rep to learn ICE scoring methodology just to
// get a lead into the system. This supplies a neutral default instead.
//
// Mid-range on all three (not 1, not 10) computes to 125 — comfortably
// under lib/kanban-column.ts's QUALIFIED_ICE_THRESHOLD (500), so a newly
// manually-added lead starts in DISCOVERED like any other unscored lead,
// never arbitrarily QUALIFIED on arrival.
export const MANUAL_LEAD_DEFAULT_ICE = { impact: 5, confidence: 5, ease: 5 } as const;
