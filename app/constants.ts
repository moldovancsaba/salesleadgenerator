// Column metadata (Check-inspired)
import type { KanbanColumn } from "./types";

export const COLUMNS: { key: KanbanColumn; label: string; description: string; color: string; icon: string }[] = [
  { key: "DISCOVERED", label: "Discovered", description: "Raw discovery queue", color: "slate", icon: "🔍" },
  { key: "QUALIFIED", label: "Qualified", description: "Fit confirmed, ICE ≥ 200", color: "blue", icon: "✓" },
  { key: "ENGAGED", label: "Engaged", description: "Active outreach, ICE ≥ 480", color: "indigo", icon: "⚡" },
  { key: "PROPOSAL", label: "Proposal", description: "In negotiation", color: "purple", icon: "📝" },
  { key: "WON", label: "Won", description: "Closed positive", color: "emerald", icon: "🏆" },
  { key: "LOST", label: "Lost", description: "Declined / no fit", color: "rose", icon: "✕" },
];
