// Issue #185 — the single source of truth for every `data-tour` attribute
// value this feature uses, so the JSX call sites (app/kanban.tsx,
// app/card.tsx, app/sales/[brand]/sales-page-client.tsx, app/detail.tsx,
// app/components/AppNav.tsx) and the step definitions in ./steps.ts can
// never drift apart into two different strings for the same target.
export const TOUR_SELECTOR = {
  kanbanBoard: 'kanban-board',
  leadCard: 'lead-card',
  leadDetailOpen: 'lead-detail-open',
  leadDetailContent: 'lead-detail-content',
  addLeadTrigger: 'add-lead-trigger',
  composeOutreach: 'tour-compose-outreach', // id, not data-tour — see app/detail.tsx's own comment
  navHamburger: 'nav-hamburger',
  brandSwitcher: 'brand-switcher',
  salesSettingsLink: 'sales-settings-link',
} as const;

export function dataTourSelector(value: string): string {
  return `[data-tour="${value}"]`;
}
