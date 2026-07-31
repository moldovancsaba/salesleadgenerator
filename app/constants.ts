// Column metadata
import type { KanbanColumn } from "./types";
import type { CurrencyCode } from "./lib/brand";

export const COLUMNS: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[] = [
  { key: "DISCOVERED", label: "Discovered", description: "Auto-managed: ICE < 500, sorted high to low", color: "blue", icon: "🔍" },
  { key: "QUALIFIED", label: "Qualified", description: "Auto-managed: ICE ≥ 500, sorted high to low", color: "indigo", icon: "✓" },
  { key: "ENGAGED", label: "Engaged", description: "Manually placed and ordered by the user", color: "green", icon: "⚡" },
  { key: "PROPOSAL", label: "Proposal", description: "Manually placed and ordered by the user", color: "orange", icon: "📝" },
  { key: "WON", label: "Won", description: "Manually placed and ordered by the user", color: "teal", icon: "🏆" },
  { key: "LOST", label: "Lost", description: "Manually placed and ordered by the user", color: "red", icon: "✕" },
];

// Issue #126 — deliberately NOT part of COLUMNS above: Backlog is never one
// of the Pipeline board's 6 rendered/auto-managed columns. Passed instead as
// app/kanban.tsx's own `columnDefs` prop when mounting the one-column
// Backlog board (app/sales/[brand]/sales-page-client.tsx's `view=backlog`).
// A module-level constant (not an inline array literal at the call site) so
// its reference is stable across renders — app/kanban.tsx's bootstrap
// effect depends on this array by reference.
export const BACKLOG_COLUMN_DEF: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[] = [
  { key: "BACKLOG", label: "Backlog", description: "Parked — not currently being worked", color: "gray", icon: "📥" },
];

// Matches lib/validate-lead.ts's ORG_SIZE_SET exactly — the same fixed
// 4-value enum the server validates `size` against on save (issue #88).
// Shared by app/detail.tsx's edit form and app/components/AddLeadModal.tsx
// (issue #127).
export const SIZE_FIELD_OPTIONS = ['Small', 'Medium', 'Large', 'Enterprise'];

export const MOBILE_MAX = 639;
export const MOBILE_LANDSCAPE_MIN = 640;
export const MOBILE_LANDSCAPE_MAX = 767;
export const TABLET_PORTRAIT_MIN = 768;
export const TABLET_PORTRAIT_MAX = 1024;
export const TABLET_LANDSCAPE_MIN = 1025;
export const TABLET_LANDSCAPE_MAX = 1279;
export const DESKTOP_MIN = 1280;

export function getIceScore(lead: { ice?: { impact: number; confidence: number; ease: number }; scoreProfile?: any }): number {
  const direct = lead.ice?.impact && lead.ice?.confidence && lead.ice?.ease
    ? lead.ice.impact * lead.ice.confidence * lead.ice.ease
    : null;
  if (direct != null) return direct;
  const blended = lead.scoreProfile?.finalBlended?.ice;
  if (typeof blended === 'number') return blended;
  return 0;
}

// Ticket size — the estimated deal value for a lead. As of issue #79 this
// reads the server-computed, firmographic-tiered ticketSizeEstimate
// (lib/ticket-size.ts) first — a low/expected/high band with a method and
// confidence, never a bare trusted-agent-written number. A lead written
// before #79 (or backfilled yet) has no ticketSizeEstimate at all; for that
// legacy case only, this falls back to the old direct-value display so
// existing leads don't go blank overnight — see issue #81 for the backfill
// that eventually retires this fallback path entirely.
export type TicketSizeDisplay =
  | {
      kind: 'estimate';
      low: number;
      expected: number;
      high: number;
      currency: CurrencyCode;
      method: 'tier_band' | 'per_unit' | 'manual_override';
      confidence: 'low' | 'medium' | 'high';
      // Present only when method === 'manual_override' (issue #86).
      overrideReason?: string;
      overriddenBy?: string;
      // True when the lead had no reliable size-tier data and this is the
      // brand's smallest configured deal-size band, not a real per-lead
      // estimate (issue #112) — the UI must say so, not present it as if
      // the lead's actual size were known.
      sizeAssumed?: boolean;
    }
  | { kind: 'unconfigured' }
  | { kind: 'legacy'; value: number; currency: CurrencyCode }
  | null;

export function getTicketSize(lead: {
  ticketSizeEstimate?: {
    method: 'tier_band' | 'per_unit' | 'unconfigured' | 'manual_override';
    low?: number;
    expected?: number;
    high?: number;
    currency?: CurrencyCode;
    confidence?: 'low' | 'medium' | 'high';
    overrideReason?: string;
    overriddenBy?: string;
    sizeAssumed?: boolean;
  };
  estimated_annual_revenue_usd?: number;
  pricingByCompany?: Record<string, { upfront_eur?: number; monthly_eur?: number; annual_fee_eur?: number }>;
}): TicketSizeDisplay {
  const est = lead.ticketSizeEstimate;
  if (est) {
    if (est.method === 'unconfigured') return { kind: 'unconfigured' };
    if (
      typeof est.low === 'number' && typeof est.expected === 'number' && typeof est.high === 'number' &&
      est.currency && est.confidence
    ) {
      return {
        kind: 'estimate',
        low: est.low,
        expected: est.expected,
        high: est.high,
        currency: est.currency,
        method: est.method,
        confidence: est.confidence,
        overrideReason: est.overrideReason,
        overriddenBy: est.overriddenBy,
        sizeAssumed: est.sizeAssumed,
      };
    }
  }

  if (typeof lead.estimated_annual_revenue_usd === 'number' && lead.estimated_annual_revenue_usd > 0) {
    return { kind: 'legacy', value: lead.estimated_annual_revenue_usd, currency: 'USD' };
  }

  if (lead.pricingByCompany && typeof lead.pricingByCompany === 'object') {
    const total = Object.values(lead.pricingByCompany).reduce((sum, entry) => {
      const upfront = entry?.upfront_eur || 0;
      const monthly = entry?.monthly_eur || 0;
      const annual = entry?.annual_fee_eur || 0;
      return sum + Math.max(annual, monthly * 12 + upfront);
    }, 0);
    if (total > 0) return { kind: 'legacy', value: total, currency: 'EUR' };
  }

  return null;
}
