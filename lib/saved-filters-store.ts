import type { Db } from 'mongodb';
import type { Brand } from '@/app/lib/brand';
import { isEmptyFilter, MAX_SAVED_FILTERS, type LeadFilter } from './saved-filters';

// Issue #214 — server-persisted, per-user, per-brand saved filters,
// replacing the old localStorage-only version. Mirrors lib/teams.ts's own
// DB-function/pure-function split: this file owns all Mongo access plus the
// upsert/cap-eviction/sharing-permission algorithm; API routes own only
// auth-gating and request/response shaping; lib/saved-filters.ts continues
// to own LeadFilter/isEmptyFilter/MAX_SAVED_FILTERS, reused here, not
// redefined.
const COLLECTION = 'saved_filters';

export type SavedFilterRecord = {
  _id: string;
  brand: Brand;
  ssoUserId: string;
  name: string;
  filter: LeadFilter;
  sharedWithBrand: boolean;
  createdAt: string;
  updatedAt: string;
};

// The shape a caller's own GET /api/saved-filters list actually returns:
// each record annotated with whether the caller owns it, and (only for a
// record shared by someone else) the owner's email for UI attribution — the
// same sso_user_access lookup app/api/leads/assignable-users already makes
// for a comparable purpose, not a new PII surface (an email within a brand
// a user already has access to, not exposed outside that scope).
export type SavedFilterListItem = SavedFilterRecord & { isMine: boolean; ownerEmail?: string };

function toRecord(doc: any): SavedFilterRecord {
  return {
    _id: doc._id.toString(),
    brand: doc.brand,
    ssoUserId: doc.ssoUserId,
    name: doc.name,
    filter: doc.filter && typeof doc.filter === 'object' ? doc.filter : {},
    sharedWithBrand: doc.sharedWithBrand === true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// --- DB-touching functions below. ---

export async function listSavedFiltersForCaller(db: Db, brand: Brand, ssoUserId: string): Promise<SavedFilterListItem[]> {
  const docs = await db.collection(COLLECTION)
    .find({ brand, $or: [{ ssoUserId }, { sharedWithBrand: true }] })
    .sort({ createdAt: 1 })
    .toArray();
  const records = docs.map((d: any) => ({ ...toRecord(d), isMine: d.ssoUserId === ssoUserId }));

  const otherOwnerIds = Array.from(new Set(records.filter((r) => !r.isMine).map((r) => r.ssoUserId)));
  if (otherOwnerIds.length === 0) return records;

  const owners = await db.collection('sso_user_access')
    .find({ ssoUserId: { $in: otherOwnerIds } })
    .project({ ssoUserId: 1, email: 1 })
    .toArray();
  const emailById = new Map(owners.map((o: any) => [o.ssoUserId, o.email as string]));
  return records.map((r) => (r.isMine ? r : { ...r, ownerEmail: emailById.get(r.ssoUserId) }));
}

export async function getSavedFilterById(db: Db, id: string): Promise<SavedFilterRecord | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(id)) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
  return doc ? toRecord(doc) : null;
}

export type UpsertSavedFilterResult =
  | { ok: true; status: 200 | 201; savedFilter: SavedFilterRecord }
  | { ok: false; status: 400 | 403; error: string };

// The single write path POST /api/saved-filters and POST
// /api/saved-filters/import both go through (§11) — upserts by
// {brand, ssoUserId, name}, replacing an existing same-named record in
// place, matching addSavedFilter's existing client-side semantics
// (lib/saved-filters.ts) now enforced server-side.
export async function upsertSavedFilter(
  db: Db,
  brand: Brand,
  ssoUserId: string,
  name: string,
  filter: LeadFilter,
  sharedWithBrand: boolean | undefined,
  canShare: boolean
): Promise<UpsertSavedFilterResult> {
  const validation = validateSavedFilterUpsert(name, filter, sharedWithBrand, canShare);
  if (!validation.ok) return { ok: false, status: validation.status, error: validation.error };
  const { trimmedName } = validation;

  const now = new Date().toISOString();
  const existing = await db.collection(COLLECTION).findOne({ brand, ssoUserId, name: trimmedName });

  if (existing) {
    // Omitted sharedWithBrand on an update leaves the existing value
    // untouched (only an explicit true/false changes it) — matches this
    // codebase's established partial-update convention (e.g.
    // app/lib/lead-actions.ts's MODIFY branch for nextActionDueAt).
    const newShared = sharedWithBrand === undefined ? existing.sharedWithBrand === true : sharedWithBrand;
    const updated = await db.collection(COLLECTION).findOneAndUpdate(
      { _id: existing._id },
      { $set: { filter, sharedWithBrand: newShared, updatedAt: now } },
      { returnDocument: 'after' }
    );
    return { ok: true, status: 200, savedFilter: toRecord(updated) };
  }

  const ownRecords = await db.collection(COLLECTION)
    .find({ brand, ssoUserId })
    .project({ createdAt: 1 })
    .toArray();
  if (ownRecords.length >= MAX_SAVED_FILTERS) {
    const oldest = pickOldestForEviction(ownRecords as Array<{ _id: unknown; createdAt: string }>);
    if (oldest) await db.collection(COLLECTION).deleteOne({ _id: oldest._id as any });
  }

  const doc = {
    brand, ssoUserId, name: trimmedName, filter,
    sharedWithBrand: sharedWithBrand === true,
    createdAt: now, updatedAt: now,
  };
  const inserted = await db.collection(COLLECTION).insertOne(doc);
  return { ok: true, status: 201, savedFilter: toRecord({ ...doc, _id: inserted.insertedId }) };
}

export async function setSavedFilterSharing(db: Db, id: string, sharedWithBrand: boolean): Promise<SavedFilterRecord | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(id)) return null;
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { sharedWithBrand, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  return result ? toRecord(result) : null;
}

export async function deleteSavedFilter(db: Db, id: string): Promise<boolean> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(id)) return false;
  const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount === 1;
}

export type ImportResult = { imported: number; skipped: number };

// One-time local-migration bulk endpoint's backing function — sharedWithBrand
// is always forced false (import never auto-shares); each entry runs
// through the same validate-and-upsert path as a normal save, invalid/empty
// entries are skipped rather than failing the whole import.
export async function importLocalFilters(
  db: Db,
  brand: Brand,
  ssoUserId: string,
  localFilters: Array<{ name: unknown; filter: unknown }>
): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;
  for (const f of localFilters) {
    if (typeof f.name !== 'string' || !f.filter || typeof f.filter !== 'object') {
      skipped += 1;
      continue;
    }
    const result = await upsertSavedFilter(db, brand, ssoUserId, f.name, f.filter as LeadFilter, false, false);
    if (result.ok) imported += 1;
    else skipped += 1;
  }
  return { imported, skipped };
}

// --- Pure functions below: no DB, no network, fully unit-testable — same
// convention as lib/teams.ts's own "Pure functions below" section. ---

export type UpsertValidationResult =
  | { ok: true; trimmedName: string }
  | { ok: false; status: 400 | 403; error: string };

// The validation/cap-eviction-selection portion of upsertSavedFilter (§11),
// split out so it's testable with zero DB, mirroring addSavedFilter's own
// existing DB-free contract.
export function validateSavedFilterUpsert(
  name: string,
  filter: LeadFilter,
  sharedWithBrand: boolean | undefined,
  canShare: boolean
): UpsertValidationResult {
  const trimmedName = name.trim();
  if (!trimmedName || isEmptyFilter(filter)) {
    return { ok: false, status: 400, error: 'Set a region, industry, or tag before saving a filter.' };
  }
  if (sharedWithBrand === true && !canShare) {
    return { ok: false, status: 403, error: 'Only brand admins can share a saved filter with the team.' };
  }
  return { ok: true, trimmedName };
}

// Oldest-dropped-first eviction — same policy as addSavedFilter's existing
// client-side slice(next.length - MAX_SAVED_FILTERS), now selecting a
// single record for a real Mongo delete instead of slicing an in-memory array.
export function pickOldestForEviction<T extends { createdAt: string }>(records: T[]): T | null {
  if (records.length === 0) return null;
  return records.reduce((oldest, r) => (new Date(r.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? r : oldest));
}
