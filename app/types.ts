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
  country: string; // ISO 3166-1 alpha-2 (US, GB, FR, DE, IT, ES, SA, AE, QA, PL, CZ, SK, HU, RO, BG, HR, RS, SI, UA, BY, LT, LV, EE, KZ, GE, AZ, AM, IL, LB, JO, IQ, KW, OM, BH, MA, TN, DZ, EG, LY, SD, SS, ET, SO, KE, NG, ZA, AU, NZ, JP, KR, CN, IN, PK, BD, LK, PH, ID, MY, TH, VN, SG, HK, TW, MO, BT, NP, MV, FJ, PG, NC, and more)
  region: "US" | "CEE" | "MENA"; // Backend region grouping — matches models/Lead.ts schema and seed data (public/*-leads.json)
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
  contact_phone?: string;
  contacts?: Array<{
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    role?: string;
  }>;
  pro_for_organization?: string | string[];
  con_for_organization?: string | string[];
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
  qualifiedAt?: string;
  lastStatusChangeAt?: string;
  autoMoved?: boolean;
  autoMoveNote?: string;
};
