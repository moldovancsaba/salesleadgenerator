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
