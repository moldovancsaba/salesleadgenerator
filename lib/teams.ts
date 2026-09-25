import type { Db } from 'mongodb';
import type { Brand } from '@/app/lib/brand';
import { isSuperAdminEmail, getRoleForBrand, type OrgAccessMap } from './sso-access';

// Team visibility (issue: CRM Team visibility) — a lightweight grouping of
// users within a single brand, plus a "manager" capability additive on top
// of the existing flat OrgAccessMap role. Deliberately its own collection,
// never denormalized onto SsoUserAccessRecord (lib/sso-access.ts) — that
// file's own isSuperAdminEmail() comment already warns about the drift risk
// of persisting a derived/relationship fact onto a record that isn't its
// source of truth; teams is that source of truth for its own membership.
const COLLECTION = 'teams';

export type Team = {
  _id: string;
  brand: Brand;
  name: string;
  memberIds: string[];
  managerIds: string[];
  createdAt: string;
  updatedAt: string;
};

function toTeam(doc: any): Team {
  return {
    _id: doc._id.toString(),
    brand: doc.brand,
    name: doc.name,
    memberIds: Array.isArray(doc.memberIds) ? doc.memberIds : [],
    managerIds: Array.isArray(doc.managerIds) ? doc.managerIds : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// --- DB-touching functions below. ---

export async function listTeamsForBrand(db: Db, brand: Brand): Promise<Team[]> {
  const docs = await db.collection(COLLECTION).find({ brand }).sort({ name: 1 }).toArray();
  return docs.map(toTeam);
}

export async function getTeam(db: Db, teamId: string): Promise<Team | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(teamId)) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(teamId) });
  return doc ? toTeam(doc) : null;
}

export async function createTeam(db: Db, brand: Brand, name: string): Promise<Team> {
  const now = new Date().toISOString();
  const doc = { brand, name, memberIds: [] as string[], managerIds: [] as string[], createdAt: now, updatedAt: now };
  const result = await db.collection(COLLECTION).insertOne(doc);
  return toTeam({ ...doc, _id: result.insertedId });
}

export type TeamUpdatePatch = { name?: string; memberIds?: string[]; managerIds?: string[] };

// Validates every id in memberIds/managerIds against sso_user_access before
// writing — mirrors setUserOrgAccess's existing "must have signed in at
// least once" contract (lib/sso-access.ts) rather than allowing a team to
// reference a ssoUserId nobody has ever seen. Throws (caught by the route,
// mapped to 400) rather than silently dropping unknown ids, matching this
// repo's "never fabricate/never silently correct bad input" convention.
export async function updateTeam(db: Db, teamId: string, patch: TeamUpdatePatch): Promise<Team | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(teamId)) return null;

  const idsToValidate = Array.from(new Set([...(patch.memberIds || []), ...(patch.managerIds || [])]));
  if (idsToValidate.length > 0) {
    const known = await db.collection('sso_user_access')
      .find({ ssoUserId: { $in: idsToValidate } })
      .project({ ssoUserId: 1 })
      .toArray();
    const knownIds = new Set(known.map((u: any) => u.ssoUserId));
    const unknown = idsToValidate.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown user id(s), must have signed in at least once: ${unknown.join(', ')}`);
    }
  }

  const $set: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) $set.name = patch.name;
  if (patch.memberIds !== undefined) $set.memberIds = patch.memberIds;
  if (patch.managerIds !== undefined) $set.managerIds = patch.managerIds;

  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(teamId) },
    { $set },
    { returnDocument: 'after' }
  );
  return result ? toTeam(result) : null;
}

export async function deleteTeam(db: Db, teamId: string): Promise<boolean> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(teamId)) return false;
  const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(teamId) });
  return result.deletedCount === 1;
}

// --- Pure functions below: no DB, no network, fully unit-testable — same
// convention as lib/sso-access.ts's own "Pure functions below" section. ---

// A manager always sees their own leads too (Set avoids double-counting a
// manager who is also listed as a memberId of their own managed team).
export function getManagedAssigneeIds(teams: Team[], ssoUserId: string): string[] {
  const managed = new Set<string>([ssoUserId]);
  for (const team of teams) {
    if (team.managerIds.includes(ssoUserId)) {
      for (const memberId of team.memberIds) managed.add(memberId);
    }
  }
  return Array.from(managed);
}

// Drives whether the frontend offers a "My Team" scope control at all — a
// non-manager should never see a control that would just re-show "My
// Leads" indistinguishably (issue's own UX requirement).
export function managesAnyTeam(teams: Team[], ssoUserId: string): boolean {
  return teams.some((team) => team.managerIds.includes(ssoUserId));
}

export type TeamVisibilityFilter = { assignedTo: { $in: string[] } } | undefined;

// Composes with the existing brand-role model rather than replacing it: a
// super admin or brand admin already sees the full brand pipeline and must
// never see LESS because of this feature, so this returns `undefined` (no
// narrowing) for both — only a plain brand `user` gets narrowed. A
// non-manager plain user still gets a valid, non-empty filter (degrades to
// exactly their own leads via getManagedAssigneeIds's self-inclusion),
// never a 400/403 — "you manage zero teams" is a normal state, not an error.
export function getTeamVisibilityFilter(
  teams: Team[],
  actorSub: string,
  actorEmail: string | undefined,
  actorOrgAccess: OrgAccessMap | undefined,
  brand: Brand
): TeamVisibilityFilter {
  if (isSuperAdminEmail(actorEmail)) return undefined;
  if (getRoleForBrand(actorEmail, actorOrgAccess, brand) === 'admin') return undefined;
  return { assignedTo: { $in: getManagedAssigneeIds(teams, actorSub) } };
}
