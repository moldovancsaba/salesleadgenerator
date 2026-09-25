import type { Db } from 'mongodb'

// Bulk actions v2 (issue #203) — pure, DB-free helpers for computing what a
// bulk action wrote (so it can be snapshotted for undo) and how to reverse
// each action's own counter side effects, plus the one small DB-touching
// helper (index setup). Mirrors this repo's established "business logic
// stays DB-free, the route/executeLeadAction do the I/O" convention
// (lib/sso-access.ts, lib/lead-assignment.ts, lib/teams.ts).

export const UNDO_COLLECTION = 'bulkActionUndoTokens'

// 15s, not the issue's own cited 10s default — a deliberate, disclosed
// implementation choice (this sandbox has no way to load-test real p99
// executeLeadAction timing across a 100-lead sequential batch, so a small
// extra margin is safer than assuming 10s comfortably covers the worst
// case). See the issue's own §16/§21 for why this number is expected to be
// revisited rather than trusted blindly.
export const UNDO_WINDOW_MS = 15000

export type BulkAction = 'ACCEPT' | 'DECLINE' | 'PIN' | 'FIELD_EDIT' | 'ASSIGN'

// The fields each bulk action actually writes to the lead document — used
// both to snapshot before/after state for undo and to build the CAS
// comparison the undo route runs before reversing. Deliberately excludes
// every Date-valued field (declinedAt, assignedAt, manualLaneOverrideAt/
// manualLaneCooldownUntil) from this set — those are never restored or
// CAS-compared; a rep can't meaningfully "change" a timestamp out from
// under an undo the way they can a kanbanColumn, tag, or assignment, and
// comparing serialized dates would only add timezone/precision fragility
// for no real benefit. activeCadence is deliberately excluded from
// DECLINE's set too — see the issue's own §15 "DECLINE + active cadence"
// edge case: restoring it verbatim could resurrect an enrollment against a
// cadence template that was since deleted/disabled, an invariant this
// design has no way to re-validate on restore, so undo never attempts it.
const WRITTEN_FIELDS_BY_ACTION: Record<Exclude<BulkAction, 'FIELD_EDIT'>, string[]> = {
  ACCEPT: ['status'],
  DECLINE: ['status', 'kanbanColumn', 'declineReason'],
  PIN: ['kanbanColumn'],
  ASSIGN: ['assignedTo', 'assignedToEmail'],
}

export function fieldsWrittenBy(action: BulkAction, field?: string): string[] {
  if (action === 'FIELD_EDIT') return field ? [field] : []
  return WRITTEN_FIELDS_BY_ACTION[action]
}

// ACCEPT/DECLINE increment cumulative counters via executeLeadAction's own
// atomic $inc (acceptanceCount/declineCount/feedbackScore) — a plain
// field-value restore can never undo that (issue #203 §15's "counter
// drift" edge case: naively writing back the old kanbanColumn alone would
// leave these counters permanently wrong after a decline-then-undo cycle).
// Returns the exact inverse $inc delta for the bulk action that was
// originally applied, or {} for an action with no counter side effect.
export function inverseCounterDelta(action: BulkAction): Record<string, number> {
  if (action === 'ACCEPT') return { acceptanceCount: -1, feedbackScore: -1 }
  if (action === 'DECLINE') return { declineCount: -1, feedbackScore: 1 }
  return {}
}

// Undefined (a field genuinely absent from the source document) is
// normalized to null rather than dropped — Mongo silently drops an
// undefined-valued key on write, which would make a captured "before"
// snapshot forget the field ever needed restoring; null round-trips
// through Mongo and back out exactly as intended (functionally identical
// to "absent" for every reader in this codebase).
export function pick(source: Record<string, any>, keys: string[]): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key of keys) {
    result[key] = source[key] === undefined ? null : source[key]
  }
  return result
}

// Deep-equal for the CAS check on undo — plain-object/array/primitive
// comparison only (no Date/RegExp/Map special-casing needed: every field
// this module ever puts in an `after` snapshot, per WRITTEN_FIELDS_BY_ACTION
// above, is a string, string[], or null).
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

// Lazily ensures the TTL index exists — same idempotent, call-on-every-
// request pattern as app/lib/activity-log-store.ts's ensureActivityLogIndexes().
// expireAfterSeconds: 0 means "expire exactly at the stored expiresAt
// value" (Mongo's own TTL-on-a-date-field convention), not "expire
// immediately."
let indexesEnsured = false
export async function ensureBulkUndoIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return
  try {
    await db.collection(UNDO_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await db.collection(UNDO_COLLECTION).createIndex({ token: 1, brand: 1, tenantId: 1 })
    indexesEnsured = true
  } catch (error) {
    console.error('[bulk-undo] index creation failed', error)
  }
}
