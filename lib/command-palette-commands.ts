// Command palette command-list assembly (issue #213) — pure, React-free
// logic extracted so "which commands exist given these inputs" is
// independently unit-testable (this repo has no component-testing
// framework installed; adding one is out of this issue's scope). The
// caller (app/sales/[brand]/sales-page-client.tsx) maps each descriptor
// here onto a real GDS `CommandDef` (id/label/keywords/group/run), wiring
// `run` to its own real handlers — this module never touches React or GDS.
//
// Single-assembler-per-scope (issue #213 §8): registerCommands() replaces
// the whole list rather than merging, so exactly one call site owns the
// full command set for a given page/scope. This is that one call site's
// pure decision logic for the sales board.

// Bounded (§16) — GDS's own filter/sort runs client-side, O(n) per
// keystroke against an in-memory array; unbounded growth on a large board
// would be the only realistic way to make that perceptible.
export const LEAD_COMMAND_CAP = 200;

export type CommandDescriptor =
  | { kind: 'add-lead' }
  | { kind: 'toggle-select-mode' }
  | { kind: 'switch-brand'; brand: string; label: string }
  | { kind: 'jump-to-lead'; leadId: string; label: string; keywords: string[] };

export type SalesBoardCommandInput = {
  accessibleBrands: string[];
  brandLabels: Record<string, string>;
  currentBrand: string;
  // Already-loaded leads only (e.g. app/kanban.tsx's own in-memory
  // columnStates) — never a live query, since GDS's CommandPalette exposes
  // no query-change hook to back one (a confirmed upstream gap, disclosed
  // in docs/ARCHITECTURE.md).
  loadedLeads: Array<{ _id: string; entity_name: string; industry?: string; sport_or_sector?: string }>;
};

// Registration order matters: with an empty query, GDS's own scorer shows
// every enabled command in registration order (all scores are 0, stable
// sort) — so the highest-frequency actions come first, the (potentially
// many) per-lead entries last.
export function buildSalesBoardCommandDescriptors(input: SalesBoardCommandInput): CommandDescriptor[] {
  const descriptors: CommandDescriptor[] = [
    { kind: 'add-lead' },
    { kind: 'toggle-select-mode' },
  ];

  // Mirrors AppNav's own accessibleBrands.length > 1 gate — a single-brand
  // user has nothing to switch to.
  if (input.accessibleBrands.length > 1) {
    for (const brand of input.accessibleBrands) {
      if (brand === input.currentBrand) continue;
      descriptors.push({ kind: 'switch-brand', brand, label: input.brandLabels[brand] || brand });
    }
  }

  for (const lead of input.loadedLeads.slice(0, LEAD_COMMAND_CAP)) {
    descriptors.push({
      kind: 'jump-to-lead',
      leadId: lead._id,
      label: lead.entity_name,
      keywords: [lead.industry, lead.sport_or_sector].filter((v): v is string => !!v),
    });
  }

  return descriptors;
}
