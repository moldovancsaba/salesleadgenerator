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
  // Decision-maker status is a flag on a contact (isDecisionMaker), not a
  // separate set of top-level fields — see lib/contacts.ts. Retired top-level
  // decision_maker_name/title/contact and contact_phone in the hard cutover
  // tracked in issue #45; those field names are no longer read anywhere.
  contacts?: Array<{
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    role?: string;
    isDecisionMaker?: boolean;
  }>;
  pro_for_organization?: string | string[];
  con_for_organization?: string | string[];
  value_proposition?: string;
  status?: string;
  notes?: string;
  // Written by POST and required by the agent's quality gate (agent-runtime/tenants.json)
  // but previously missing from this type entirely.
  product_fit_notes?: string;
  tags?: string[];
  kanbanColumn: KanbanColumn;
  sortOrder: number;
  fingerprint?: string;
  ice?: { impact: number; confidence: number; ease: number };
  // Matches buildScoreProfile()'s real return shape (app/api/leads/route.ts) —
  // previously `any`, the only field on this whole type with no shape at all.
  scoreProfile?: {
    agentProposal: { impact: number; confidence: number; effort: number };
    calibratedHeuristic: { impact: number; confidence: number; effort: number };
    finalBlended: {
      ice: number;
      quality: number;
      urgency: number;
      freshness: number;
      humanSignal: number;
      risk: number;
    };
    qualityDimensions: {
      evidenceQuality: number;
      linguisticQuality: number;
      actionabilityQuality: number;
      strategicValue: number;
    };
  };
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
  createdAt?: string;
  updatedAt?: string;
  // CogMap forecast fields (ticket size)
  estimated_annual_revenue_usd?: number;
  estimated_participants?: number;
  recommended_tier?: "essential" | "performance" | "elite" | "multiple";
  revenue_model?: "per_participant" | "revenue_share" | "hybrid";
  // Seyu forecast fields (ticket size)
  pricingByCompany?: Record<string, {
    currency?: string;
    upfront_eur?: number;
    monthly_eur?: number;
    annual_fee_eur?: number;
    discount_percent?: number;
    revenue_share_percent?: number;
    pricing_model?: string;
    notes?: string;
  }>;
};
