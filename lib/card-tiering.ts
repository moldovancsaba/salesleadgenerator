// Kanban card information hierarchy (issue #213) — the one genuinely
// conditional piece of app/card.tsx's LeadCard tiering decision, extracted
// into a pure, independently unit-testable function (this repo has no
// component-testing framework installed, and adding one is out of this
// issue's scope, so the conditional logic itself is what's tested here).
//
// Tier 0 (always visible): entity name, rotten/staleness/DEAL/quality
// badges, Region, and Ticket-size-or-Deal-value.
// Tier 1 (behind the in-card expand toggle): ICE/Size/Contact (always
// present, unconditionally, same "every card has the same shape" rule
// those fields already followed before this issue) plus Win probability
// (conditional — see below), tags, industry/sector, the ticket-size
// caption, checklist progress, follow-up due state, the next-step nudge,
// and the created/updated line.

// Win probability is Tier-1-conditional on two independent things: a
// terminal lead (WON/LOST) has already closed, so a probability figure is
// meaningless for it; and the caller may simply have no forecast data
// loaded yet (Forecast section collapsed upstream) and pass undefined/null.
export function shouldShowWinProbability(isTerminalColumn: boolean, winProbability: number | null | undefined): boolean {
  return !isTerminalColumn && typeof winProbability === 'number' && Number.isFinite(winProbability);
}
