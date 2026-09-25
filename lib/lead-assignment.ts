// Lead ownership (issue: CRM Lead ownership) — pure, DB-free assignment
// rules, matching lib/sso-access.ts's own "pure functions below: no DB, no
// network" convention (§7 of the issue: deterministic logic, no opaque
// heuristics — "who can assign to whom" is a plain role check).

import type { OrgRole } from './sso-access';

// self-assign (targetAssignedTo === actorSub) is always allowed for any
// brand user. Self-release (clearing an assignment that currently belongs
// to the caller) is likewise always allowed — the issue's own pseudocode
// only names "self-assign" and "clearing someone else's assignment", but a
// rep who cannot hand back a lead they hold without bugging an admin would
// undermine the feature; this is a deliberate, minimal extension beyond the
// literal spec, so canAssign takes the lead's current assignment as well as
// the requested new one. Every other case (assigning to, or clearing,
// someone else's assignment) requires the actor's brand role to be admin.
export function canAssign(
  actorSub: string,
  actorBrandRole: OrgRole | null,
  targetAssignedTo: string | null,
  currentAssignedTo?: string | null
): boolean {
  if (targetAssignedTo === actorSub) return true;
  if (targetAssignedTo === null && currentAssignedTo === actorSub) return true;
  if (actorBrandRole === 'admin') return true;
  return false;
}

export type AssignedToFilterClause =
  | { assignedTo: string }
  | { $or: Array<{ assignedTo: { $exists: false } } | { assignedTo: null }> }
  | undefined;

// 'me' is resolved by the caller into a real ssoUserId (actorSub) BEFORE
// this is called — never accepted as a literal string a client could spoof
// to mean another user. When no session-derived actorSub is available (a
// machine/x-api-key caller, or 'me' requested with no session), the caller
// passes '' — `{ assignedTo: '' }` matches no real lead (assignedTo is
// always a real ssoUserId or absent), so this fails safe rather than
// silently returning every lead.
//
// 'unassigned' matches BOTH a legacy document with no assignedTo field at
// all and one explicitly cleared via ASSIGN (assignedTo: null) — both are
// "unassigned" and must appear identically in a My Leads/unassigned view.
export function resolveAssignedToFilter(param: string | undefined, actorSub: string): AssignedToFilterClause {
  if (param === undefined) return undefined;
  if (param === 'me') return { assignedTo: actorSub };
  if (param === 'unassigned') {
    return { $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] };
  }
  return { assignedTo: param };
}

// Combines a base equality-filter object with an optional clause that may
// itself carry a top-level $or (resolveAssignedToFilter's 'unassigned'
// case) WITHOUT risking the object-spread $or collision this repo has hit
// twice before (docs/LESSONS_LEARNED.md §1 — tenantFilter()'s own $or for
// the default tenant was silently dropped by a sibling $or spread into the
// same object in both app/api/leads/[id]/route.ts and app/api/search/
// route.ts). baseFilter may ALSO already carry a top-level $or (tenantFilter
// on the default tenant) — so when clause is present, the two are combined
// via $and rather than merged into one object, exactly like this file's own
// existing cursorFilter combination.
export function combineFilterWithAssignedTo(baseFilter: Record<string, any>, clause: AssignedToFilterClause): Record<string, any> {
  if (!clause) return baseFilter;
  return { $and: [baseFilter, clause] };
}
