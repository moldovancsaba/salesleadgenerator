// Issue #128 — pure diff/merge-rule engine for the duplicate-lead merge
// feature (owner request, 2026-07-27). No DB access, no Date.now()/
// Math.random() — fully unit-testable, matching this repo's established
// pattern for logic modules (lib/stale-deal.ts, lib/rotten-indicator.ts).
//
// Every Lead field is classified into exactly one of four buckets on every
// diffLeads() call — this is what keeps the merge UI simple: it only ever
// has to render 'conflict' entries, everything else already has a decided
// answer. See docs/ARCHITECTURE.md's "Duplicate Lead Merge" section for the
// full field-by-field rationale.

import type { Lead, KanbanColumn, QualityStatus } from '../app/types';
import { dedupeContacts } from './contacts';
import { buildFingerprint } from './fingerprint';
import { buildScoreProfile } from './score-profile';
import { generateClassificationTags, buildMergeKey } from './lead-classification';

export type FieldClassification =
  | { kind: 'auto-union'; field: string; mergedValue: unknown }
  | { kind: 'auto-resolved'; field: string; mergedValue: unknown; rule: string }
  | { kind: 'fill-from-one-side'; field: string; mergedValue: unknown; source: 'A' | 'B' }
  | { kind: 'conflict'; field: string; valueA: unknown; valueB: unknown };

type ConflictClassification = Extract<FieldClassification, { kind: 'conflict' }>;

// BACKLOG and DISCOVERED share rank 0 — Backlog isn't "behind" Discovered in
// any progress sense, it's a parallel parked state (issue #126); either can
// freely lose to the other side's more-advanced stage without that being a
// meaningful judgment call.
const KANBAN_ORDER: Record<string, number> = {
  BACKLOG: 0,
  DISCOVERED: 0,
  QUALIFIED: 1,
  ENGAGED: 2,
  PROPOSAL: 3,
  WON: 4,
};

// Mirrors lib/quality-registry.ts's DRAFT < CHECKED < VERIFIED hierarchy —
// not imported directly, since that module's own exported function
// (enforceQualityCeiling) answers a different question (a ceiling given a
// list of upstream statuses), not "which of these two is higher."
const QUALITY_ORDER: Record<QualityStatus, number> = { DRAFT: 0, CHECKED: 1, VERIFIED: 2 };

function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Classifies a single scalar/object-shaped field per the shared 3-way
// absent/equal/different rule every plain conflict-candidate field uses.
function classifyScalar(field: string, a: unknown, b: unknown): FieldClassification | null {
  const aAbsent = isAbsent(a);
  const bAbsent = isAbsent(b);
  if (aAbsent && bAbsent) return null;
  if (aAbsent) return { kind: 'fill-from-one-side', field, mergedValue: b, source: 'B' };
  if (bAbsent) return { kind: 'fill-from-one-side', field, mergedValue: a, source: 'A' };
  if (deepEqual(a, b)) return null;
  return { kind: 'conflict', field, valueA: a, valueB: b };
}

// ticketSizeEstimate gets its own comparison, excluding `computedAt` — every
// real recompute (lib/ticket-size-store.ts) stamps a fresh timestamp, which
// would otherwise make virtually every real pair look "different" even when
// the actual low/expected/high/method/confidence are identical.
function classifyTicketSizeEstimate(a: Lead['ticketSizeEstimate'], b: Lead['ticketSizeEstimate']): FieldClassification | null {
  const aAbsent = isAbsent(a);
  const bAbsent = isAbsent(b);
  if (aAbsent && bAbsent) return null;
  if (aAbsent) return { kind: 'fill-from-one-side', field: 'ticketSizeEstimate', mergedValue: b, source: 'B' };
  if (bAbsent) return { kind: 'fill-from-one-side', field: 'ticketSizeEstimate', mergedValue: a, source: 'A' };
  const { computedAt: _computedAtA, ...restA } = a as NonNullable<Lead['ticketSizeEstimate']>;
  const { computedAt: _computedAtB, ...restB } = b as NonNullable<Lead['ticketSizeEstimate']>;
  if (deepEqual(restA, restB)) return null;
  return { kind: 'conflict', field: 'ticketSizeEstimate', valueA: a, valueB: b };
}

function unionById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return Array.from(byId.values());
}

function ensureArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function resolveEarlier(field: string, a: string | undefined, b: string | undefined): FieldClassification {
  if (!a) return { kind: 'auto-resolved', field, mergedValue: b, rule: 'earlier of the two (only one side present)' };
  if (!b) return { kind: 'auto-resolved', field, mergedValue: a, rule: 'earlier of the two (only one side present)' };
  const mergedValue = new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  return { kind: 'auto-resolved', field, mergedValue, rule: 'earlier of the two — the real-world entity has existed since then' };
}

function resolveLater(field: string, a: string | undefined, b: string | undefined): FieldClassification {
  if (!a) return { kind: 'auto-resolved', field, mergedValue: b, rule: 'later of the two (only one side present)' };
  if (!b) return { kind: 'auto-resolved', field, mergedValue: a, rule: 'later of the two (only one side present)' };
  const mergedValue = new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  return { kind: 'auto-resolved', field, mergedValue, rule: 'later of the two' };
}

function resolveQualityStatus(a: QualityStatus, b: QualityStatus): FieldClassification {
  const rank = (s: QualityStatus) => QUALITY_ORDER[s] ?? 0;
  const mergedValue = rank(a) >= rank(b) ? a : b;
  return { kind: 'auto-resolved', field: 'qualityStatus', mergedValue, rule: 'higher of the two (DRAFT < CHECKED < VERIFIED)' };
}

function resolveTechSignals(leadA: Lead, leadB: Lead): FieldClassification {
  const aAt = leadA.techSignalsScannedAt ? new Date(leadA.techSignalsScannedAt).getTime() : -Infinity;
  const bAt = leadB.techSignalsScannedAt ? new Date(leadB.techSignalsScannedAt).getTime() : -Infinity;
  const winner = aAt >= bAt ? leadA : leadB;
  return {
    kind: 'auto-resolved',
    field: 'techSignals',
    mergedValue: {
      techSignals: winner.techSignals,
      techSignalsScannedAt: winner.techSignalsScannedAt,
      techSignalsScanStatus: winner.techSignalsScanStatus,
    },
    rule: 'most recently scanned side wins (whole bundle, not a system/business decision)',
  };
}

function resolveNextAction(leadA: Lead, leadB: Lead): FieldClassification {
  const aDue = leadA.nextActionDueAt ? new Date(leadA.nextActionDueAt).getTime() : null;
  const bDue = leadB.nextActionDueAt ? new Date(leadB.nextActionDueAt).getTime() : null;
  let winner: Lead;
  if (aDue == null && bDue == null) winner = leadA;
  else if (aDue == null) winner = leadB;
  else if (bDue == null) winner = leadA;
  else winner = aDue <= bDue ? leadA : leadB;
  return {
    kind: 'auto-resolved',
    field: 'nextAction',
    mergedValue: { nextActionDueAt: winner.nextActionDueAt ?? null, nextActionNote: winner.nextActionNote },
    rule: 'sooner due date wins, as a pair with its own note — a more urgent follow-up must never be silently dropped',
  };
}

// The only kanbanColumn combination that is a genuine conflict rather than a
// progress comparison — a deal can't be both won and lost, so this is
// pulled out of the generic "further along wins" rule and surfaced to a
// human instead of ever auto-picked.
function resolveKanbanColumn(a: KanbanColumn, b: KanbanColumn): FieldClassification {
  const terminal = new Set(['WON', 'LOST']);
  if (terminal.has(a) && terminal.has(b) && a !== b) {
    return { kind: 'conflict', field: 'kanbanColumn', valueA: a, valueB: b };
  }
  const rank = (c: KanbanColumn) => KANBAN_ORDER[c] ?? 0;
  const mergedValue = rank(a) >= rank(b) ? a : b;
  return { kind: 'auto-resolved', field: 'kanbanColumn', mergedValue, rule: 'further-along pipeline stage wins' };
}

// Every plain scalar/object field where a genuine, different, non-empty
// value on both sides is a real conflict a human must resolve.
const SIMPLE_CONFLICT_FIELDS: Array<keyof Lead> = [
  'entity_name', 'url', 'address', 'general_contact', 'size', 'industry',
  'sport_or_sector', 'level_league', 'value_proposition', 'notes',
  'product_fit_notes', 'status', 'source', 'region', 'country',
  'actualDealValueUsd', 'estimated_annual_revenue_usd', 'estimated_participants',
  'recommended_tier', 'revenue_model', 'ice',
  // Controlled sports-industry taxonomy (rulebook v1.0, 2026-07-28) —
  // genuinely different values here are exactly the rulebook's "never
  // merge" identity-critical signals (different sport, city, gender,
  // business unit, or parent organisation are different entities, never
  // silently auto-resolved). `classificationTags`/`mergeKey` are
  // deliberately excluded — both are recomputed from these fields below,
  // never independent conflict candidates.
  'sportCode', 'orgTypeCode', 'businessUnitCode', 'genderCode',
  'competitionLevelCode', 'cityName', 'parentOrgId', 'parentOrgName',
  'relationshipToParent', 'canonicalLeadName',
];

const QUALIFICATION_FIELDS = ['budgetConfirmed', 'budgetNotes', 'authorityConfirmed', 'needNotes', 'timelineEstimate'] as const;

// A reasonable starting suggestion for which lead should survive a merge —
// the UI always lets the operator flip this before committing, so this only
// needs to be a sensible default, not a hard rule. Further-along pipeline
// stage wins first (more real progress represents more real work already
// done); ties broken by whichever was most recently touched (freshest data).
export function suggestPrimaryId(leadA: Lead, leadB: Lead): string {
  const rank = (c: KanbanColumn) => KANBAN_ORDER[c] ?? 0;
  const rankA = rank(leadA.kanbanColumn);
  const rankB = rank(leadB.kanbanColumn);
  if (rankA !== rankB) return rankA > rankB ? leadA._id : leadB._id;
  const updatedA = leadA.updatedAt ? new Date(leadA.updatedAt).getTime() : 0;
  const updatedB = leadB.updatedAt ? new Date(leadB.updatedAt).getTime() : 0;
  return updatedA >= updatedB ? leadA._id : leadB._id;
}

export function diffLeads(leadA: Lead, leadB: Lead): FieldClassification[] {
  const out: FieldClassification[] = [];

  // Bucket 1 — auto-union, list-shaped fields. Always safe to combine: two
  // leads' contacts/tags/deals/checklist/pros/cons are independently real
  // facts, never contradictory in the way a single scalar value can be.
  out.push({ kind: 'auto-union', field: 'contacts', mergedValue: dedupeContacts([...(leadA.contacts || []), ...(leadB.contacts || [])]) });
  out.push({ kind: 'auto-union', field: 'tags', mergedValue: Array.from(new Set([...(leadA.tags || []), ...(leadB.tags || [])])) });
  out.push({ kind: 'auto-union', field: 'deals', mergedValue: unionById([...(leadA.deals || []), ...(leadB.deals || [])]) });
  out.push({ kind: 'auto-union', field: 'checklist', mergedValue: unionById([...(leadA.checklist || []), ...(leadB.checklist || [])]) });
  out.push({ kind: 'auto-union', field: 'pro_for_organization', mergedValue: Array.from(new Set([...ensureArray(leadA.pro_for_organization), ...ensureArray(leadB.pro_for_organization)])) });
  out.push({ kind: 'auto-union', field: 'con_for_organization', mergedValue: Array.from(new Set([...ensureArray(leadA.con_for_organization), ...ensureArray(leadB.con_for_organization)])) });
  // Rulebook demographic tags (§10) are non-exclusive by nature — a lead can
  // legitimately be both "youth" and "adult" (a multi-age academy) — so
  // unioning both sides' values is always safe, unlike the identity-critical
  // scalars in SIMPLE_CONFLICT_FIELDS below.
  out.push({ kind: 'auto-union', field: 'demographicCodes', mergedValue: Array.from(new Set([...ensureArray(leadA.demographicCodes), ...ensureArray(leadB.demographicCodes)])) });

  // Bucket 2 — auto-resolved by a genuinely correct, non-arbitrary rule.
  out.push(resolveEarlier('createdAt', leadA.createdAt, leadB.createdAt));
  out.push(resolveLater('updatedAt', leadA.updatedAt, leadB.updatedAt));
  out.push({ kind: 'auto-resolved', field: 'feedbackScore', mergedValue: (leadA.feedbackScore || 0) + (leadB.feedbackScore || 0), rule: 'summed' });
  out.push({ kind: 'auto-resolved', field: 'declineCount', mergedValue: (leadA.declineCount || 0) + (leadB.declineCount || 0), rule: 'summed' });
  out.push({ kind: 'auto-resolved', field: 'acceptanceCount', mergedValue: (leadA.acceptanceCount || 0) + (leadB.acceptanceCount || 0), rule: 'summed' });
  out.push(resolveQualityStatus(leadA.qualityStatus, leadB.qualityStatus));
  out.push(resolveTechSignals(leadA, leadB));
  out.push(resolveNextAction(leadA, leadB));
  out.push(resolveKanbanColumn(leadA.kanbanColumn, leadB.kanbanColumn));

  // Bucket 3/4 — every plain conflict-candidate scalar/object field.
  for (const field of SIMPLE_CONFLICT_FIELDS) {
    const classification = classifyScalar(field, (leadA as any)[field], (leadB as any)[field]);
    if (classification) out.push(classification);
  }
  const ticketSizeClassification = classifyTicketSizeEstimate(leadA.ticketSizeEstimate, leadB.ticketSizeEstimate);
  if (ticketSizeClassification) out.push(ticketSizeClassification);

  // qualification.* — each sub-field its own independent classification;
  // e.g. differing budgetNotes shouldn't block an identical authorityConfirmed
  // from auto-filling.
  for (const sub of QUALIFICATION_FIELDS) {
    const classification = classifyScalar(`qualification.${sub}`, leadA.qualification?.[sub], leadB.qualification?.[sub]);
    if (classification) out.push(classification);
  }

  // pricingByCompany — per company key; keys present on only one side
  // auto-fill, a key both sides define differently is its own conflict.
  const pricingKeys = new Set([...Object.keys(leadA.pricingByCompany || {}), ...Object.keys(leadB.pricingByCompany || {})]);
  for (const key of pricingKeys) {
    const classification = classifyScalar(`pricingByCompany.${key}`, leadA.pricingByCompany?.[key], leadB.pricingByCompany?.[key]);
    if (classification) out.push(classification);
  }

  return out;
}

function applyField(target: any, field: string, value: unknown): void {
  if (field === 'nextAction') {
    target.nextActionDueAt = (value as any).nextActionDueAt;
    target.nextActionNote = (value as any).nextActionNote;
    return;
  }
  if (field === 'techSignals') {
    target.techSignals = (value as any).techSignals;
    target.techSignalsScannedAt = (value as any).techSignalsScannedAt;
    target.techSignalsScanStatus = (value as any).techSignalsScanStatus;
    return;
  }
  if (field.startsWith('qualification.')) {
    const sub = field.slice('qualification.'.length);
    target.qualification = { ...(target.qualification || {}), [sub]: value };
    return;
  }
  if (field.startsWith('pricingByCompany.')) {
    const key = field.slice('pricingByCompany.'.length);
    target.pricingByCompany = { ...(target.pricingByCompany || {}), [key]: value };
    return;
  }
  target[field] = value;
}

// Builds the final merged Lead document. `primaryId` picks which of the two
// input leads' identity/bookkeeping fields (_id, sortOrder, tenantId, the
// manual-lane override bookkeeping) survive — every other field is decided
// by diffLeads()'s own classification plus, for real conflicts, the
// caller-supplied `resolutions`. Throws if a conflict diffLeads() actually
// found has no matching entry in `resolutions` — never silently guesses.
export function buildMergedLead(
  leadA: Lead,
  leadB: Lead,
  primaryId: string,
  resolutions: Record<string, 'A' | 'B'>
): Lead {
  if (primaryId !== leadA._id && primaryId !== leadB._id) {
    throw new Error(`primaryId ${primaryId} does not match either lead being merged`);
  }

  const classifications = diffLeads(leadA, leadB);
  const conflicts = classifications.filter((c): c is ConflictClassification => c.kind === 'conflict');
  const missing = conflicts.filter((c) => resolutions[c.field] !== 'A' && resolutions[c.field] !== 'B');
  if (missing.length > 0) {
    throw new Error(`Missing merge resolution for conflicting field(s): ${missing.map((c) => c.field).join(', ')}`);
  }

  const primary = leadA._id === primaryId ? leadA : leadB;
  const secondary = leadA._id === primaryId ? leadB : leadA;
  void secondary; // not directly referenced — every field it can contribute flows through `classifications`

  const merged: any = { ...primary };

  for (const c of classifications) {
    if (c.kind === 'conflict') {
      const chosenSide = resolutions[c.field];
      applyField(merged, c.field, chosenSide === 'A' ? c.valueA : c.valueB);
    } else {
      applyField(merged, c.field, c.mergedValue);
    }
  }

  // declineReason/declinedAt are only ever meaningful when the FINAL
  // kanbanColumn is LOST, and are always taken from whichever original lead
  // that final value actually came from — never asked as an independent
  // conflict (a lead can't be "a bit LOST for this reason and a bit LOST for
  // that one" — the reason belongs to the specific LOST determination that won).
  const finalColumn: KanbanColumn = merged.kanbanColumn;
  if (finalColumn === 'LOST') {
    const sourceOfColumn = leadA.kanbanColumn === 'LOST' ? leadA : leadB;
    merged.declineReason = sourceOfColumn.declineReason;
    merged.declinedAt = sourceOfColumn.declinedAt;
  } else {
    delete merged.declineReason;
    delete merged.declinedAt;
  }

  // scoreProfile is always a pure function of ice — must be recomputed from
  // the final, possibly-conflict-resolved ice values, never carried over
  // stale from whichever lead happened to become primary.
  if (merged.ice) {
    merged.scoreProfile = buildScoreProfile(merged.ice.impact, merged.ice.confidence, merged.ice.ease);
  }

  // Identity/bookkeeping fields — always the primary's own, never merged or
  // derived from the classification loop above.
  merged._id = primary._id;
  merged.id = primary.id;
  merged.sortOrder = primary.sortOrder;
  merged.tenantId = (primary as any).tenantId;
  merged.manualLaneOverrideAt = primary.manualLaneOverrideAt;
  merged.manualLaneCooldownUntil = primary.manualLaneCooldownUntil;
  merged.manualLaneFloorColumn = primary.manualLaneFloorColumn;
  merged.manualLaneOverrideBy = primary.manualLaneOverrideBy;

  // Recomputed, not copied — the merged entity_name/url/region may differ
  // from primary's own original values once conflicts are resolved, so the
  // fingerprint must reflect the lead's actual final identity fields, not a
  // stale one that no longer matches what's stored.
  merged.fingerprint = buildFingerprint(merged.entity_name, merged.url || '', merged.region);

  // classificationTags/mergeKey are always derived from the merged entity's
  // own final taxonomy fields (rulebook v1.0, §15/§5) — same reasoning as
  // fingerprint above: recomputed from the post-merge state, never carried
  // over stale from whichever side happened to become primary.
  const classificationInput = {
    parentOrgName: merged.parentOrgName,
    sportCode: merged.sportCode,
    orgTypeCode: merged.orgTypeCode,
    businessUnitCode: merged.businessUnitCode,
    genderCode: merged.genderCode,
    demographicCodes: merged.demographicCodes,
    country: merged.country,
    cityName: merged.cityName,
  };
  // Gated the same way as the PUT/MODIFY handlers (app/api/leads/[id]/route.ts,
  // app/lib/lead-actions.ts): only write classificationTags/mergeKey when the
  // merged lead actually carries some taxonomy data, so leads never touched by
  // the rulebook classification workflow don't get a synthetic all-"unknown"
  // mergeKey manufactured purely as a side effect of an unrelated merge.
  const hasAnyClassification = Boolean(
    classificationInput.sportCode || classificationInput.orgTypeCode
    || classificationInput.businessUnitCode || classificationInput.genderCode
    || (classificationInput.demographicCodes && classificationInput.demographicCodes.length > 0)
    || classificationInput.cityName || classificationInput.parentOrgName
  );
  if (hasAnyClassification) {
    merged.classificationTags = generateClassificationTags(classificationInput);
    merged.mergeKey = buildMergeKey(classificationInput);
  }

  return merged as Lead;
}
