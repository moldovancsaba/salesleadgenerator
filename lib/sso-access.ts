import type { Db } from 'mongodb';
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand';

// Issue #103: DoneIsBetter SSO's own permission API is per-app ("can this
// person use salesleadgenerator at all" — pending/approved/revoked), not
// per-brand ("can they see CogMap vs. Seyu"). That distinction is this
// app's own business logic, so it needs its own collection — DoneIsBetter
// has no concept of it at all.
const COLLECTION = 'sso_user_access';

export type OrgRole = 'admin' | 'user';
export type OrgAccessMap = Partial<Record<Brand, OrgRole>>;

export type SsoUserAccessRecord = {
  ssoUserId: string;
  email: string;
  name?: string;
  orgAccess: OrgAccessMap;
  createdAt: string;
  updatedAt: string;
};

// Deliberately NOT persisted as a field on the record — persisting it risks
// drift (a record created while someone was a super admin stays stamped
// `true` after their email is removed from the env var). Always derived
// fresh from SSO_SUPER_ADMIN_EMAILS against the verified ID token's own
// `email` claim. This is the safety net against ever locking the sole
// operator out via a bug in the per-org assignment logic itself: a super
// admin bypasses `orgAccess` entirely, unconditionally, for every brand.
export function isSuperAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const configured = (process.env.SSO_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(email.trim().toLowerCase());
}

// Called once per successful login (app/api/oauth/callback/route.ts), never
// on every session check (app/api/auth/session/route.ts is read-only) —
// this is the only write path that creates a record, so a brand-new SSO
// user always shows up in the admin UI with `orgAccess: {}` the moment they
// first sign in, ready for the super admin to grant access.
export async function upsertUserSeen(
  db: Db,
  { ssoUserId, email, name }: { ssoUserId: string; email: string; name?: string }
): Promise<SsoUserAccessRecord> {
  const collection = db.collection<SsoUserAccessRecord>(COLLECTION);
  const now = new Date().toISOString();
  await collection.updateOne(
    { ssoUserId },
    {
      $set: { email, ...(name ? { name } : {}), updatedAt: now },
      $setOnInsert: { ssoUserId, orgAccess: {}, createdAt: now },
    },
    { upsert: true }
  );
  const record = await collection.findOne({ ssoUserId });
  return record as unknown as SsoUserAccessRecord;
}

export async function getUserAccess(db: Db, ssoUserId: string): Promise<SsoUserAccessRecord | null> {
  const collection = db.collection<SsoUserAccessRecord>(COLLECTION);
  return (await collection.findOne({ ssoUserId })) as unknown as SsoUserAccessRecord | null;
}

export async function listAllUserAccess(db: Db): Promise<SsoUserAccessRecord[]> {
  const collection = db.collection<SsoUserAccessRecord>(COLLECTION);
  return (await collection.find({}).sort({ updatedAt: -1 }).toArray()) as unknown as SsoUserAccessRecord[];
}

const VALID_ROLES: OrgRole[] = ['admin', 'user'];

// role: null revokes access to that one brand (removes the key entirely,
// rather than storing a `'none'` role — an absent key and an explicit
// "no access" role would otherwise be two representations of the same
// state, an easy place for a future bug to check one and miss the other).
export async function setUserOrgAccess(
  db: Db,
  ssoUserId: string,
  brand: Brand,
  role: OrgRole | null
): Promise<SsoUserAccessRecord | null> {
  if (!(brand in BRAND_CONFIG)) {
    throw new Error(`Unknown brand: ${brand}`);
  }
  if (role !== null && !VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const collection = db.collection<SsoUserAccessRecord>(COLLECTION);
  const now = new Date().toISOString();
  if (role === null) {
    await collection.updateOne({ ssoUserId }, { $unset: { [`orgAccess.${brand}`]: '' }, $set: { updatedAt: now } });
  } else {
    await collection.updateOne({ ssoUserId }, { $set: { [`orgAccess.${brand}`]: role, updatedAt: now } });
  }
  return getUserAccess(db, ssoUserId);
}

// --- Pure functions below: no DB, no network, fully unit-testable. ---

export function getAccessibleBrands(email: string | undefined, orgAccess: OrgAccessMap | undefined): Brand[] {
  if (isSuperAdminEmail(email)) return Object.keys(BRAND_CONFIG) as Brand[];
  return (Object.keys(orgAccess || {}) as Brand[]).filter((brand) => Boolean(orgAccess?.[brand]));
}

export function hasAccessToBrand(email: string | undefined, orgAccess: OrgAccessMap | undefined, brand: Brand): boolean {
  if (isSuperAdminEmail(email)) return true;
  return Boolean(orgAccess?.[brand]);
}

export function getRoleForBrand(email: string | undefined, orgAccess: OrgAccessMap | undefined, brand: Brand): OrgRole | null {
  if (isSuperAdminEmail(email)) return 'admin';
  return orgAccess?.[brand] || null;
}

// Where app/api/oauth/callback/route.ts sends a user right after a
// successful login. DoneIsBetter's own app-level permissionStatus is
// checked first (pending/revoked are their gate, not this app's); only once
// that's clear does this app's own zero-organization-access state matter —
// approved by DoneIsBetter but not yet assigned to any brand here is a
// genuinely first-time user, not a login failure, and gets the same warm
// "we'll be in touch" page as a DoneIsBetter-pending user.
export function resolveLoginDestination(
  permissionStatus: 'pending' | 'approved' | 'revoked' | undefined | null,
  email: string | undefined,
  orgAccess: OrgAccessMap | undefined
): '/access-pending' | '/access-denied' | '/' {
  if (permissionStatus === 'pending') return '/access-pending';
  if (permissionStatus === 'revoked') return '/access-denied';
  if (getAccessibleBrands(email, orgAccess).length === 0) return '/access-pending';
  return '/';
}
