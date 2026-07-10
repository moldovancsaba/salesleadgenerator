// Types shared across Kanban components

// Kanban columns
export type KanbanColumn =
  | "DISCOVERED"
  | "QUALIFIED"
  | "ENGAGED"
  | "PROPOSAL"
  | "WON"
  | "LOST";

export type QualityStatus = "DRAFT" | "CHECKED" | "VERIFIED";

export type DeclineReason =
  | "WRONG_INDUSTRY"
  | "NO_DECISION_MAKER"
  | "TOO_SMALL"
  | "ALREADY_COMPETITOR"
  | "BAD_TIMING"
  | "BUDGET_CONSTRAINTS"
  | "NOT_RESPONSIVE"
  | "MISSING_CONTEXT"
  | "LOW_PRIORITY"
  | "OTHER";

export type Lead = {
  _id: string;
  id?: number;
  region: "US" | "CEE" | "MENA";
  entity_name: string;
  url?: string;
  address?: string;
  general_contact?: string;
  size?: string;
  industry?: string;
  sport_or_sector?: string;
  level_league?: string;
  decision_maker_name?: string;
  decision_maker_title?: string;
  decision_maker_contact?: string;
  pro_for_cogmap?: string[];
  con_for_cogmap?: string[];
  value_proposition?: string;
  priority?: "high" | "medium" | "low";
  status?: string;
  notes?: string;
  tags?: string[];
  kanbanColumn: KanbanColumn;
  sortOrder: number;
  fingerprint?: string;
  ice?: { impact: number; confidence: number; ease: number };
  scoreProfile?: any;
  qualityStatus: QualityStatus;
  feedbackScore: number;
  declineCount: number;
  acceptanceCount: number;
  declineReason?: DeclineReason;
  declinedAt?: string;
  manualLaneOverrideAt?: string;
  manualLaneCooldownUntil?: string;
  manualLaneFloorColumn?: string;
  manualLaneOverrideBy?: string;
  lastActionAt?: string;
  createdAt?: string;
  updatedAt?: string;
};
