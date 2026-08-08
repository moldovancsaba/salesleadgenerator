// Types shared across Kanban components

import type { CurrencyCode } from './lib/brand';
import type { ActiveCadence } from '../lib/cadences';

// Kanban columns
export type KanbanColumn =
  | "DISCOVERED"
  | "QUALIFIED"
  | "ENGAGED"
  | "PROPOSAL"
  | "WON"
  | "LOST"
  // Issue #126 — a lead a rep isn't working right now, but hasn't declined.
  // Deliberately not part of app/constants.ts's COLUMNS (the 6-column
  // Pipeline board's own list) — never rendered there, never auto-managed,
  // reachable only via an explicit "Move to Backlog" action.
  | "BACKLOG";

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
  // Controlled sports-industry taxonomy — owner spec, 2026-07-28 ("Sport
  // Sales Lead Catalogue and Deduplication Rulebook v1.0"), see
  // lib/lead-taxonomy.ts for the enums and lib/lead-classification.ts for
  // tag/merge-key generation. Deliberately additive and fully optional: a
  // lead with none of these set is exactly as valid as before this change
  // — see docs/LEAD_TAXONOMY_MIGRATION_PLAN.md for the backfill plan.
  // `sport_or_sector`/`industry` above are untouched free text, kept for
  // backward compatibility; these are the new, validated, controlled
  // equivalents the enrichment process should populate going forward.
  sportCode?: string;
  orgTypeCode?: string;
  businessUnitCode?: string;
  genderCode?: string;
  demographicCodes?: string[];
  competitionLevelCode?: string;
  // Structured city, distinct from the free-text `address` field above —
  // this app had no structured city field at all before this change.
  cityName?: string;
  // Parent-organisation linkage (rulebook §2.2/§14). `parentOrgId` points at
  // a `parent_organisations` collection document once that concept exists
  // in this app (tracked separately, not part of this initial rollout);
  // `parentOrgName` is a denormalized display value usable immediately.
  parentOrgId?: string;
  parentOrgName?: string;
  relationshipToParent?: string;
  // Rulebook naming convention (§13): `entity_name` above is the
  // "source_name" equivalent (verbatim, never overwritten); this is the
  // normalized display name built from the classification fields.
  canonicalLeadName?: string;
  // Rulebook §5: generated from the structured fields above, never
  // hand-authored — kept separate from the pre-existing free-text `tags`
  // field below, which is operator-authored labels (issue #116), a
  // different concept with its own established filter UI.
  classificationTags?: string[];
  // Rulebook §15: deterministic candidate-identity key for duplicate
  // detection — a match makes two leads worth comparing, it never proves
  // they're the same lead (see lib/near-duplicate.ts).
  mergeKey?: string;
  classificationConfidence?: number;
  classificationEvidence?: string[];
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
    // ISO timestamp of last confirmed-accurate verifiable-field data — see
    // lib/contact-freshness.ts, issue #66. Undefined means never verified.
    lastVerifiedAt?: string;
    // MX-based domain-deliverability signal, written back asynchronously
    // after create/update — see lib/email-verification.ts, issue #67.
    // Undefined means the background check hasn't landed yet.
    emailVerificationStatus?: {
      status: 'unverified' | 'mx-verified' | 'mx-failed' | 'check-error';
      checkedAt: string | null;
      isRoleAccount: boolean;
      isFreeProvider: boolean;
      mxHosts?: string[];
      error?: string;
    };
    // Rule-based (not ML), derived from `title` on every write — see
    // lib/title-normalization.ts, issue #68. Not user-editable.
    seniorityTier?: 'C-level' | 'VP' | 'Director' | 'Manager' | 'IC' | 'Unknown';
    department?: 'Sales' | 'Marketing' | 'Operations' | 'Executive' | 'Unknown';
  }>;
  // Lowercased index of every contacts[] email, kept in sync on every
  // contact write path by lib/contacts.ts's deriveContactEmails() — issue
  // #142's inbound-reply matching index. Server-derived, not user-editable.
  contactEmails?: string[];
  pro_for_organization?: string | string[];
  con_for_organization?: string | string[];
  value_proposition?: string;
  status?: string;
  notes?: string;
  // Written by POST and required by the research agent's quality gate
  // (config now lives in that separate app, not this repo — see issue #99)
  // but previously missing from this type entirely.
  product_fit_notes?: string;
  tags?: string[];
  // Pattern-matched from the homepage HTML by an SSRF-guarded background scan
  // — see lib/tech-stack-scan.ts, issue #69. Not user-editable. Undefined
  // techSignalsScanStatus means no scan has run yet for this lead.
  techSignals?: string[];
  techSignalsScannedAt?: string;
  techSignalsScanStatus?: 'ok' | 'blocked' | 'timeout' | 'invalid_url' | 'non_html' | 'error';
  // Server-computed, firmographic-tiered deal-size estimate — see
  // lib/ticket-size.ts, issue #79. Replaces trusting the free-written
  // estimated_annual_revenue_usd/pricingByCompany fields below directly;
  // those remain as agent-supplied signals/audit trail, no longer the
  // authoritative displayed ticket size. `method: 'unconfigured'` means the
  // brand hasn't set up deal-size bands/product pricing in Sales Settings
  // yet — an honest state, never a fabricated number.
  ticketSizeEstimate?: {
    method: 'tier_band' | 'per_unit' | 'unconfigured' | 'manual_override';
    computedAt: string;
    low?: number;
    expected?: number;
    high?: number;
    currency?: CurrencyCode;
    confidence?: 'low' | 'medium' | 'high';
    // Present only when method === 'manual_override' (issue #86) — a rep's
    // direct override, permanently exempt from automated recompute (#82)
    // until explicitly cleared.
    overrideReason?: string;
    overriddenBy?: string;
    // True when the lead had no reliable size-tier data and this is the
    // brand's smallest configured deal-size band, not a real per-lead
    // estimate (issue #112).
    sizeAssumed?: boolean;
  };
  // The real, closed contract value (always USD) once a lead is WON — see
  // lib/ticket-size-calibration.ts, issue #83. Captured via MODIFY, never
  // computed. Undefined means not yet recorded, not a $0 deal.
  actualDealValueUsd?: number;
  // Manually-managed deals, distinct from the auto-computed ticketSizeEstimate
  // above — see lib/deals.ts, issue #114. Never auto-created/edited; a rep
  // adds these directly or converts a ticket estimate into one. Multiple
  // deals per lead are allowed (e.g. renewal + add-on).
  deals?: Array<{
    id: string;
    value: number;
    currency: CurrencyCode;
    label?: string;
    createdAt: string;
    updatedAt: string;
    source: 'manual' | 'converted_ticket_estimate';
  }>;
  // Per-item action checklist, distinct from the free-text `notes` field
  // above — see lib/checklist.ts, issue #117.
  checklist?: Array<{
    id: string;
    text: string;
    done: boolean;
    createdAt: string;
    completedAt?: string;
  }>;
  // Scheduled follow-up commitment, distinct from the passive, rule-derived
  // suggestions in lib/next-step-nudge.ts — see issue #121. Lead-level, not
  // per-rep: this app has no user/ownership model. `null` explicitly clears
  // an existing reminder (vs. omission, which leaves it unchanged).
  nextActionDueAt?: string | null;
  nextActionNote?: string;
  // A lead's own position on a sales cadence template (lib/cadences.ts,
  // issue #124/#149) — which step it's on and when the next one is due.
  // Exactly one active cadence per lead at a time (enforced at enroll time,
  // not here); `null` explicitly clears it (cancel/complete/auto-cancel on
  // DECLINE or LOST), same convention as nextActionDueAt above.
  activeCadence?: ActiveCadence | null;
  // Lightweight BANT-style qualification signals, informational only — not
  // wired into lib/stage-gate.ts's required-fields gate. See issue #122.
  // authorityConfirmed is a deal-level judgment call, distinct from any
  // individual contact's isDecisionMaker flag above.
  qualification?: {
    budgetConfirmed?: boolean;
    budgetNotes?: string;
    authorityConfirmed?: boolean;
    needNotes?: string;
    timelineEstimate?: string;
  };
  // Acquisition channel, e.g. "manual" | "research_agent" | "referral" |
  // "outbound_list" | "event" | "inbound" — see issue #123. Freeform string
  // (not a closed enum) so brand-specific channels don't require a code
  // change to record.
  source?: string;
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
