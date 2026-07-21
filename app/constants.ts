// Column metadata (Check-inspired)
import type { KanbanColumn } from "./types";
import type { SemanticTone } from "./theme/semantic";

export const COLUMNS: { key: KanbanColumn; label: string; description: string; color: SemanticTone; icon: string }[] = [
  { key: "DISCOVERED", label: "Discovered", description: "Raw discovery queue", color: "ingress", icon: "🔍" },
  { key: "QUALIFIED", label: "Qualified", description: "Fit confirmed, ICE ≥ 200", color: "synthesis", icon: "✓" },
  { key: "ENGAGED", label: "Engaged", description: "Active outreach, ICE ≥ 480", color: "tactical", icon: "⚡" },
  { key: "PROPOSAL", label: "Proposal", description: "In negotiation", color: "strategy", icon: "📝" },
  { key: "WON", label: "Won", description: "Closed positive", color: "review", icon: "🏆" },
  { key: "LOST", label: "Lost", description: "Declined / no fit", color: "neutral", icon: "✕" },
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
