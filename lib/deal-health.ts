// Engagement-Weighted Deal Health Score (0-100) (issue #280) — pure,
// framework/DB-free multi-signal deal health engine.
//
// Evaluates 5 transparent dimensions (100 points total):
// 1. Fit & Quality (0-25 pts): ICE score & qualityStatus
// 2. Activity Freshness (0-25 pts): days since last touch vs stage threshold
// 3. Buying Committee & Verified Contact (0-20 pts): contact email + decision maker / champion + no unmitigated blocker
// 4. Next-Action & Cadence Hygiene (0-15 pts): active cadence or non-overdue scheduled follow-up
// 5. Commercial & Qualification Readiness (0-15 pts): deal/ticket estimate + qualification progress

import { computeStaleness, DEFAULT_STALE_THRESHOLDS, type KanbanColumn } from './stale-deal';
import { sumDeals, type Deal } from './deals';

export type DealHealthTier = 'healthy' | 'at_risk' | 'critical';

export type DealHealthFactor = {
  dimension: string;
  score: number;
  maxScore: number;
  status: 'positive' | 'warning' | 'negative';
  detail: string;
};

export type DealHealthResult = {
  score: number;
  tier: DealHealthTier;
  label: string;
  factors: DealHealthFactor[];
};

export type DealHealthLeadInput = {
  kanbanColumn?: string;
  updatedAt?: string;
  ice?: { impact?: number; confidence?: number; ease?: number } | null;
  qualityStatus?: string;
  contacts?: Array<{
    name?: string;
    email?: string;
    emailVerificationStatus?: string | { status?: string };
    isDecisionMaker?: boolean;
    buyingRole?: string;
  }> | null;
  activeCadence?: { cadenceId?: string } | null;
  nextActionDueAt?: string | null;
  deals?: Deal[] | null;
  ticketSizeEstimate?: { expected?: number } | null;
  estimatedTicketSize?: number | null;
  qualification?: {
    budgetConfirmed?: boolean;
    authorityConfirmed?: boolean;
    needNotes?: string;
    timelineEstimate?: string;
  } | null;
};

export function computeDealHealth(
  lead: DealHealthLeadInput,
  now: Date = new Date()
): DealHealthResult {
  const stage = (lead.kanbanColumn || 'DISCOVERED') as KanbanColumn;

  if (stage === 'WON') {
    return {
      score: 100,
      tier: 'healthy',
      label: 'Closed Won (100)',
      factors: [
        {
          dimension: 'Outcome',
          score: 100,
          maxScore: 100,
          status: 'positive',
          detail: 'Deal is closed-won.',
        },
      ],
    };
  }

  if (stage === 'LOST') {
    return {
      score: 0,
      tier: 'critical',
      label: 'Closed Lost (0)',
      factors: [
        {
          dimension: 'Outcome',
          score: 0,
          maxScore: 100,
          status: 'negative',
          detail: 'Deal is closed-lost.',
        },
      ],
    };
  }

  const factors: DealHealthFactor[] = [];

  // 1. Fit & Quality (0-25 pts)
  const ice = lead.ice || { impact: 0, confidence: 0, ease: 0 };
  const iceProduct = (ice.impact || 0) * (ice.confidence || 0) * (ice.ease || 0);
  const icePoints = Math.min(18, Math.round((iceProduct / 750) * 18));
  const qualityPoints =
    lead.qualityStatus === 'VERIFIED' ? 7 : lead.qualityStatus === 'CHECKED' ? 4 : 2;
  const fitScore = Math.min(25, icePoints + qualityPoints);
  factors.push({
    dimension: 'Fit & Quality',
    score: fitScore,
    maxScore: 25,
    status: fitScore >= 18 ? 'positive' : fitScore >= 10 ? 'warning' : 'negative',
    detail: `ICE ${iceProduct}/1000 · ${lead.qualityStatus || 'DRAFT'}`,
  });

  // 2. Activity Freshness (0-25 pts)
  const staleness = computeStaleness(
    { kanbanColumn: stage, updatedAt: lead.updatedAt },
    DEFAULT_STALE_THRESHOLDS,
    now
  );
  let freshnessScore = 25;
  let freshnessDetail = 'Recently active within stage SLA';
  if (staleness) {
    if (staleness.severity === 'critical') {
      freshnessScore = 3;
      freshnessDetail = `Critical inactivity (${staleness.daysSince}d idle vs ${staleness.thresholdDays}d SLA)`;
    } else {
      freshnessScore = 10;
      freshnessDetail = `Stale (${staleness.daysSince}d idle vs ${staleness.thresholdDays}d SLA)`;
    }
  } else if (!lead.updatedAt) {
    freshnessScore = 15;
    freshnessDetail = 'No recent activity timestamp recorded';
  }
  factors.push({
    dimension: 'Momentum & Freshness',
    score: freshnessScore,
    maxScore: 25,
    status: freshnessScore >= 20 ? 'positive' : freshnessScore >= 10 ? 'warning' : 'negative',
    detail: freshnessDetail,
  });

  // 3. Buying Committee & Verified Contact (0-20 pts)
  const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
  const hasEmailContact = contacts.some((c) => typeof c?.email === 'string' && c.email.trim().length > 0);
  const hasVerifiedEmail = contacts.some(
    (c) =>
      c?.emailVerificationStatus === 'valid' ||
      c?.emailVerificationStatus === 'mx-verified' ||
      (typeof c?.emailVerificationStatus === 'object' &&
        c?.emailVerificationStatus?.status === 'mx-verified')
  );
  const hasChampionOrDecisionMaker = contacts.some(
    (c) =>
      c?.isDecisionMaker === true ||
      c?.buyingRole === 'economic_buyer' ||
      c?.buyingRole === 'decision_maker' ||
      c?.buyingRole === 'champion'
  );
  const hasBlocker = contacts.some((c) => c?.buyingRole === 'blocker');

  let committeeScore = 0;
  if (hasEmailContact) committeeScore += 10;
  if (hasVerifiedEmail) committeeScore += 4;
  if (hasChampionOrDecisionMaker) committeeScore += 6;
  if (hasBlocker && !hasChampionOrDecisionMaker) committeeScore = Math.max(0, committeeScore - 6);
  committeeScore = Math.min(20, committeeScore);

  factors.push({
    dimension: 'Buying Committee',
    score: committeeScore,
    maxScore: 20,
    status: committeeScore >= 14 ? 'positive' : committeeScore >= 8 ? 'warning' : 'negative',
    detail: !hasEmailContact
      ? 'Missing contact email address'
      : hasChampionOrDecisionMaker
        ? 'Decision-maker / Champion identified'
        : 'Contact present; no Decision-Maker tagged yet',
  });

  // 4. Next-Action & Cadence Hygiene (0-15 pts)
  let hygieneScore = 4;
  let hygieneDetail = 'No next follow-up or active sequence scheduled';
  if (lead.activeCadence?.cadenceId) {
    hygieneScore = 15;
    hygieneDetail = 'Enrolled in active outreach cadence';
  } else if (lead.nextActionDueAt) {
    const dueMs = new Date(lead.nextActionDueAt).getTime();
    if (!Number.isNaN(dueMs)) {
      const diffDays = Math.floor((dueMs - now.getTime()) / 86_400_000);
      if (diffDays >= -1) {
        hygieneScore = 15;
        hygieneDetail = 'Next follow-up action scheduled on time';
      } else {
        hygieneScore = 5;
        hygieneDetail = `Next follow-up overdue by ${Math.abs(diffDays)}d`;
      }
    }
  }
  factors.push({
    dimension: 'Next-Step Hygiene',
    score: hygieneScore,
    maxScore: 15,
    status: hygieneScore >= 12 ? 'positive' : hygieneScore >= 5 ? 'warning' : 'negative',
    detail: hygieneDetail,
  });

  // 5. Commercial & Qualification Readiness (0-15 pts)
  const hasExplicitDeal = sumDeals(lead.deals || []) > 0;
  const hasEstimate =
    (lead.ticketSizeEstimate?.expected ?? 0) > 0 || (lead.estimatedTicketSize ?? 0) > 0;
  const qual = lead.qualification;
  const qualSignals =
    (qual?.budgetConfirmed ? 1 : 0) +
    (qual?.authorityConfirmed ? 1 : 0) +
    (qual?.needNotes?.trim() ? 1 : 0) +
    (qual?.timelineEstimate?.trim() ? 1 : 0);

  let commercialScore = 0;
  if (hasExplicitDeal) commercialScore += 9;
  else if (hasEstimate) commercialScore += 5;
  commercialScore += Math.min(6, qualSignals * 2);
  commercialScore = Math.min(15, commercialScore);

  factors.push({
    dimension: 'Commercial Readiness',
    score: commercialScore,
    maxScore: 15,
    status: commercialScore >= 10 ? 'positive' : commercialScore >= 5 ? 'warning' : 'negative',
    detail: hasExplicitDeal
      ? `Active deal scoped · ${qualSignals}/4 qualification signals`
      : hasEstimate
        ? `Ticket size estimated · ${qualSignals}/4 qualification signals`
        : 'No deal value or ticket estimate scoped yet',
  });

  const totalScore = Math.max(
    0,
    Math.min(
      100,
      factors.reduce((sum, f) => sum + f.score, 0)
    )
  );

  const tier: DealHealthTier =
    totalScore >= 70 ? 'healthy' : totalScore >= 40 ? 'at_risk' : 'critical';

  const label =
    tier === 'healthy'
      ? `Healthy (${totalScore})`
      : tier === 'at_risk'
        ? `At Risk (${totalScore})`
        : `Critical (${totalScore})`;

  return {
    score: totalScore,
    tier,
    label,
    factors,
  };
}
