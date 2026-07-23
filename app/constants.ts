// Column metadata
import type { KanbanColumn } from "./types";

export const COLUMNS: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[] = [
  { key: "DISCOVERED", label: "Discovered", description: "Raw discovery queue", color: "blue", icon: "🔍" },
  { key: "QUALIFIED", label: "Qualified", description: "Fit confirmed, ICE ≥ 200", color: "indigo", icon: "✓" },
  { key: "ENGAGED", label: "Engaged", description: "Active outreach, ICE ≥ 480", color: "green", icon: "⚡" },
  { key: "PROPOSAL", label: "Proposal", description: "In negotiation", color: "orange", icon: "📝" },
  { key: "WON", label: "Won", description: "Closed positive", color: "teal", icon: "🏆" },
  { key: "LOST", label: "Lost", description: "Declined / no fit", color: "red", icon: "✕" },
];

export const MOBILE_MAX = 639;
export const MOBILE_LANDSCAPE_MIN = 640;
export const MOBILE_LANDSCAPE_MAX = 767;
export const TABLET_PORTRAIT_MIN = 768;
export const TABLET_PORTRAIT_MAX = 1024;
export const TABLET_LANDSCAPE_MIN = 1025;
export const TABLET_LANDSCAPE_MAX = 1279;
export const DESKTOP_MIN = 1280;

export const ICE_QUALIFIED_THRESHOLD = 500;

export function getIceScore(lead: { ice?: { impact: number; confidence: number; ease: number }; scoreProfile?: any }): number {
  const direct = lead.ice?.impact && lead.ice?.confidence && lead.ice?.ease
    ? lead.ice.impact * lead.ice.confidence * lead.ice.ease
    : null;
  if (direct != null) return direct;
  const blended = lead.scoreProfile?.finalBlended?.ice;
  if (typeof blended === 'number') return blended;
  return 0;
}

// Ticket size — the estimated deal value for a lead. CogMap leads carry a
// direct annual-revenue estimate (USD); Seyu leads carry per-company pricing
// blocks (EUR) instead, summed using the same max(annual, monthly*12+upfront)
// formula the /api/boards/[brand] forecast already uses server-side.
export function getTicketSize(lead: {
  estimated_annual_revenue_usd?: number;
  pricingByCompany?: Record<string, { upfront_eur?: number; monthly_eur?: number; annual_fee_eur?: number }>;
}): { value: number; currency: 'USD' | 'EUR' } | null {
  if (typeof lead.estimated_annual_revenue_usd === 'number' && lead.estimated_annual_revenue_usd > 0) {
    return { value: lead.estimated_annual_revenue_usd, currency: 'USD' };
  }

  if (lead.pricingByCompany && typeof lead.pricingByCompany === 'object') {
    const total = Object.values(lead.pricingByCompany).reduce((sum, entry) => {
      const upfront = entry?.upfront_eur || 0;
      const monthly = entry?.monthly_eur || 0;
      const annual = entry?.annual_fee_eur || 0;
      return sum + Math.max(annual, monthly * 12 + upfront);
    }, 0);
    if (total > 0) return { value: total, currency: 'EUR' };
  }

  return null;
}
