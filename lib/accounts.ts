// Accounts: parent-organization rollup (issue #209, Phase 1 — virtual/
// computed view, no new Mongo collection). Groups a brand/tenant's own
// leads by the existing Lead.parentOrgId string field (rulebook §2.2/§14,
// issue #131) and computes a read-only rollup. Pure, Mongo-free module —
// same split as lib/forecast-category.ts/lib/quota.ts (pure math) vs.
// app/lib/quota-store.ts (Mongo-aware caller).
//
// Grouping is exact-string-match on parentOrgId, deliberately not
// fuzzy/normalized — two leads with the same real-world parent but
// different parentOrgId strings (a typo, a casing difference) render as
// two separate Accounts in Phase 1. This is a disclosed, accepted
// limitation of the virtual-view approach (see docs/ARCHITECTURE.md), not
// a bug: reconciling that is Phase 2's explicitly deferred scope (a real
// `accounts` collection + a merge-queue UI), not built here.

import type { Db } from 'mongodb';
import type { CurrencyCode } from '@/app/lib/brand-constants';

export type AccountRollup = {
  parentOrgId: string;
  parentOrgName: string | null;
  relationshipCodes: string[];
  leadCount: number;
  leadsByColumn: Record<string, number>;
  contactCount: number;
  // Despite the "Usd" suffix (kept for API-contract fidelity to this
  // issue's own §9 spec), these are NOT converted to USD — see the
  // currency-mismatch handling below and docs/ARCHITECTURE.md's disclosed
  // resolution of the resulting naming inconsistency for EUR-configured
  // brands (seyu, dvsc).
  pipelineValueUsd: number;
  wonValueUsd: number;
  mostRecentUpdatedAt: string | null;
};

// Only the fields this module actually reads from a Lead — deliberately
// not `import type { Lead }` for the source shape, since callers (the API
// route) only ever project these fields out of Mongo.
export type AccountSourceLead = {
  _id: string;
  entity_name?: string;
  parentOrgId?: string;
  parentOrgName?: string;
  relationshipToParent?: string;
  kanbanColumn?: string;
  sport_or_sector?: string;
  businessUnitCode?: string;
  contacts?: unknown[];
  ticketSizeEstimate?: {
    method: 'tier_band' | 'per_unit' | 'unconfigured' | 'manual_override';
    expected?: number;
    currency?: CurrencyCode;
  };
  actualDealValueUsd?: number;
  updatedAt?: string;
};

export type AccountLeadSummary = {
  _id: string;
  entity_name: string;
  kanbanColumn?: string;
  sport_or_sector?: string;
  businessUnitCode?: string;
  relationshipToParent?: string;
  ticketSizeEstimate?: AccountSourceLead['ticketSizeEstimate'];
  actualDealValueUsd?: number;
  updatedAt?: string;
};

export type AccountDetail = AccountRollup & { leads: AccountLeadSummary[] };

function isNewer(candidate: string | null | undefined, current: string | null | undefined): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const candidateTime = new Date(candidate).getTime();
  const currentTime = new Date(current).getTime();
  if (Number.isNaN(candidateTime)) return false;
  if (Number.isNaN(currentTime)) return true;
  return candidateTime > currentTime;
}

// Groups leads by parentOrgId; leads with no (or blank) parentOrgId are
// excluded entirely — never grouped under a synthetic "unknown" bucket
// (issue #209 §10's own explicit contract).
export function groupLeadsByParentOrg(leads: AccountSourceLead[]): Map<string, AccountSourceLead[]> {
  const groups = new Map<string, AccountSourceLead[]>();
  for (const lead of leads) {
    const parentOrgId = (lead.parentOrgId || '').trim();
    if (!parentOrgId) continue;
    const existing = groups.get(parentOrgId);
    if (existing) existing.push(lead);
    else groups.set(parentOrgId, [lead]);
  }
  return groups;
}

// One group's rollup — shared by both computeAccountRollups() (list) and
// computeAccountDetail() (single account), so the two can never disagree
// on the same math.
export function buildAccountRollup(
  parentOrgId: string,
  groupLeads: AccountSourceLead[],
  brandCurrency: CurrencyCode
): AccountRollup {
  const leadsByColumn: Record<string, number> = {};
  const relationshipCodes = new Set<string>();
  let contactCount = 0;
  let pipelineValueUsd = 0;
  let wonValueUsd = 0;
  let mostRecentUpdatedAt: string | null = null;
  let parentOrgName: string | null = null;
  let parentOrgNameUpdatedAt: string | null = null;

  for (const lead of groupLeads) {
    const column = lead.kanbanColumn || 'UNKNOWN';
    leadsByColumn[column] = (leadsByColumn[column] || 0) + 1;

    if (lead.relationshipToParent) relationshipCodes.add(lead.relationshipToParent);

    contactCount += Array.isArray(lead.contacts) ? lead.contacts.length : 0;

    if (lead.kanbanColumn === 'WON' && typeof lead.actualDealValueUsd === 'number') {
      // actualDealValueUsd is contractually always real USD (app/types.ts's
      // own comment) — this half of the sum is genuinely USD.
      wonValueUsd += lead.actualDealValueUsd;
    } else {
      const estimate = lead.ticketSizeEstimate;
      // 'unconfigured' estimates carry no `expected` at all (see
      // lib/ticket-size.ts's TicketSizeUnconfigured) — excluded as an
      // honest omission, never counted as $0 (issue #209 §15).
      if (estimate && estimate.method !== 'unconfigured' && typeof estimate.expected === 'number') {
        // Currency-mismatch exclusion (issue #209 §15): a
        // ticketSizeEstimate whose own currency doesn't match the brand's
        // configured currency is excluded from the sum entirely, never
        // converted — this repo has no currency-conversion utility
        // anywhere (verified by full-repo search). See
        // docs/ARCHITECTURE.md for the resulting disclosed naming caveat.
        if (!estimate.currency || estimate.currency === brandCurrency) {
          pipelineValueUsd += estimate.expected;
        }
      }
    }

    if (isNewer(lead.updatedAt, mostRecentUpdatedAt)) mostRecentUpdatedAt = lead.updatedAt || null;
    if (lead.parentOrgName && lead.parentOrgName.trim() && isNewer(lead.updatedAt, parentOrgNameUpdatedAt)) {
      parentOrgName = lead.parentOrgName.trim();
      parentOrgNameUpdatedAt = lead.updatedAt || null;
    }
  }

  return {
    parentOrgId,
    parentOrgName,
    relationshipCodes: Array.from(relationshipCodes),
    leadCount: groupLeads.length,
    leadsByColumn,
    contactCount,
    pipelineValueUsd,
    wonValueUsd,
    mostRecentUpdatedAt,
  };
}

function rollupRank(rollup: AccountRollup): number {
  return rollup.pipelineValueUsd + rollup.wonValueUsd;
}

export function computeAccountRollups(leads: AccountSourceLead[], brandCurrency: CurrencyCode): AccountRollup[] {
  const groups = groupLeadsByParentOrg(leads);
  const rollups: AccountRollup[] = [];
  for (const [parentOrgId, groupLeads] of groups) {
    rollups.push(buildAccountRollup(parentOrgId, groupLeads, brandCurrency));
  }
  return rollups.sort((a, b) => rollupRank(b) - rollupRank(a));
}

function toLeadSummary(lead: AccountSourceLead): AccountLeadSummary {
  return {
    _id: lead._id,
    entity_name: lead.entity_name || '',
    kanbanColumn: lead.kanbanColumn,
    sport_or_sector: lead.sport_or_sector,
    businessUnitCode: lead.businessUnitCode,
    relationshipToParent: lead.relationshipToParent,
    ticketSizeEstimate: lead.ticketSizeEstimate,
    actualDealValueUsd: lead.actualDealValueUsd,
    updatedAt: lead.updatedAt,
  };
}

// Returns null when parentOrgId matches zero leads in the given set — the
// caller (the API route) maps that to a 404, per issue #209 §10.
export function computeAccountDetail(
  parentOrgId: string,
  leads: AccountSourceLead[],
  brandCurrency: CurrencyCode
): AccountDetail | null {
  const groupLeads = leads.filter((lead) => (lead.parentOrgId || '').trim() === parentOrgId);
  if (groupLeads.length === 0) return null;
  const rollup = buildAccountRollup(parentOrgId, groupLeads, brandCurrency);
  return { ...rollup, leads: groupLeads.map(toLeadSummary) };
}

// Lazily-ensured, idempotent per collection — same convention as
// lib/contacts.ts's ensureContactEmailsIndex() (each brand's leads live in
// its own collection, so each needs its own index call). Issue #209 §16's
// own required {tenantId, parentOrgId} index for the grouping query.
const accountsIndexEnsured = new Set<string>();
export async function ensureAccountsIndex(db: Db, collectionName: string): Promise<void> {
  if (accountsIndexEnsured.has(collectionName)) return;
  try {
    await db.collection(collectionName).createIndex({ tenantId: 1, parentOrgId: 1 });
    accountsIndexEnsured.add(collectionName);
  } catch (error) {
    console.error('[accounts] tenantId+parentOrgId index creation failed', { collectionName, error });
  }
}
