// Per-field provenance — issue #188. Every stored data point carries where it
// came from and when it was established, so "is this phone number stale?" is
// answerable per field instead of per record.
//
// Shared by every lead write path (POST /api/leads, PUT /api/leads/[id], and
// PATCH ... MODIFY via lib/contacts.ts) for the same reason lib/contacts.ts
// exists: three routes with three near-duplicate implementations is the exact
// bug issue #45 already fixed once for contacts[]. One module, one behaviour.

import { isValidVerificationMethod, VERIFICATION_METHODS } from './lead-taxonomy';
import type { VerificationMethod } from './lead-taxonomy';

export type FieldVerification = {
  // The field this entry describes. At lead scope: a scalar lead field name.
  // At contact scope: a bare contact field name (`phone`, `email`, …) — never
  // a path, because the contact object it lives on already identifies it.
  field: string;
  verifiedAt: string;
  method: VerificationMethod;
  // Evidence URL. Absent for methods that have no URL to point at
  // (admin/user/phone/email).
  sourceUrl?: string;
  // Who or what established this. Never a product, model, or provider name.
  verifiedBy?: string;
};

// Oldest-evicted-first ceiling. A weekly re-verification loop would otherwise
// grow the document without bound; last-write-wins per (field, method) does
// most of the work, and this caps the pathological case where a client keeps
// inventing new field names.
export const MAX_FIELD_VERIFICATIONS = 60;

// Full ISO-8601 timestamp, not a bare date. Ordering and eviction both depend
// on this being comparable, and `Date.parse` alone accepts loose formats whose
// interpretation varies — a silently-misparsed timestamp would evict the wrong
// entry. Same reasoning as validate-lead.ts's integer check on ice.*.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Mirrors validate-lead.ts's URL_RE. Kept local rather than imported: that
// module imports this one, so sharing the constant the other way round would
// close an import cycle.
const SOURCE_URL_RE = /^https?:\/\/\S+$/i;

// A top-level entry may never address a contact field. contacts[] is reindexed
// on every write by dedupeContacts() (lib/contacts.ts) — it drops contacts with
// no name/email/phone and collapses duplicates — so a positional path silently
// comes to describe a different person, carrying a confident timestamp. That is
// strictly worse than storing no provenance. Contact provenance lives on the
// contact object instead, which cannot be reindexed away from its own data.
//
// Matches `contacts`, `contacts[0].phone`, `contacts.0.phone` and
// `contacts[email=x@y.z].phone` alike — the first path segment is enough.
const CONTACT_PATH_RE = /^\s*contacts\s*(\[|\.|$)/i;

export function isContactFieldPath(field: unknown): boolean {
  return typeof field === 'string' && CONTACT_PATH_RE.test(field);
}

export type FieldVerificationScope = 'lead' | 'contact';

/**
 * Format/vocabulary errors for one `fieldVerifications` array. Pure — returns
 * messages, never mutates. Collapsing and capping are normalization and live in
 * normalizeFieldVerifications() below.
 */
export function validateFieldVerifications(
  value: unknown,
  scope: FieldVerificationScope = 'lead',
  label = 'fieldVerifications'
): string[] {
  const errors: string[] = [];
  if (value === undefined || value === null) return errors;

  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return errors;
  }

  value.forEach((entry: any, index: number) => {
    const at = `${label}[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }

    if (typeof entry.field !== 'string' || !entry.field.trim()) {
      errors.push(`${at}.field is required`);
    } else if (scope === 'lead' && isContactFieldPath(entry.field)) {
      // The single most important rejection in this module — see CONTACT_PATH_RE.
      errors.push(
        `${at}.field must not address a contact ("${entry.field}"): contacts[] is reindexed on every write, ` +
        `so a positional path cannot stay pointed at the same person. Put the entry on the contact object instead.`
      );
    }

    if (typeof entry.verifiedAt !== 'string' || !ISO_TIMESTAMP_RE.test(entry.verifiedAt) || !Number.isFinite(Date.parse(entry.verifiedAt))) {
      errors.push(`${at}.verifiedAt must be a full ISO-8601 timestamp`);
    }

    if (!isValidVerificationMethod(entry.method)) {
      errors.push(`${at}.method must be one of: ${VERIFICATION_METHODS.join(', ')}`);
    }

    if (entry.sourceUrl !== undefined && entry.sourceUrl !== null && entry.sourceUrl !== '') {
      if (typeof entry.sourceUrl !== 'string' || !SOURCE_URL_RE.test(entry.sourceUrl.trim())) {
        errors.push(`${at}.sourceUrl must be a valid HTTP(S) URL`);
      }
    }

    if (entry.verifiedBy !== undefined && entry.verifiedBy !== null && typeof entry.verifiedBy !== 'string') {
      errors.push(`${at}.verifiedBy must be a string`);
    }
  });

  return errors;
}

/**
 * Collapse to one entry per (field, method) keeping the newest verifiedAt, then
 * cap at MAX_FIELD_VERIFICATIONS evicting oldest first.
 *
 * Re-verifying an unchanged field updates its timestamp in place rather than
 * appending, which is what makes a repeating verification loop safe to run
 * forever. Entries that fail validateFieldVerifications() are dropped here
 * rather than throwing — callers validate first and reject the whole request;
 * this is the belt to that braces, so a bad entry can never reach storage even
 * on a path that forgot to validate.
 */
export function normalizeFieldVerifications(value: unknown): FieldVerification[] {
  if (!Array.isArray(value)) return [];

  const byPair = new Map<string, FieldVerification>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const field = typeof raw.field === 'string' ? raw.field.trim() : '';
    const verifiedAt = typeof raw.verifiedAt === 'string' ? raw.verifiedAt.trim() : '';
    if (!field || !ISO_TIMESTAMP_RE.test(verifiedAt)) continue;
    if (!isValidVerificationMethod(raw.method)) continue;

    const entry: FieldVerification = { field, verifiedAt, method: raw.method };

    const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl.trim() : '';
    if (sourceUrl && SOURCE_URL_RE.test(sourceUrl)) entry.sourceUrl = sourceUrl;

    const verifiedBy = typeof raw.verifiedBy === 'string' ? raw.verifiedBy.trim() : '';
    if (verifiedBy) entry.verifiedBy = verifiedBy;

    const key = `${field}|${entry.method}`;
    const prior = byPair.get(key);
    // Strictly newer replaces. Equal timestamps keep the first seen, so the
    // result is deterministic for a payload that repeats an entry verbatim.
    if (!prior || Date.parse(entry.verifiedAt) > Date.parse(prior.verifiedAt)) {
      byPair.set(key, entry);
    }
  }

  const sorted = Array.from(byPair.values()).sort((a, b) => {
    const delta = Date.parse(a.verifiedAt) - Date.parse(b.verifiedAt);
    if (delta !== 0) return delta;
    // Deterministic tie-break so two equal timestamps don't reorder between
    // writes and make a stored document churn for no reason.
    return a.field.localeCompare(b.field) || a.method.localeCompare(b.method);
  });

  // Oldest first in the sorted array, so keeping the tail keeps the newest.
  return sorted.length > MAX_FIELD_VERIFICATIONS
    ? sorted.slice(sorted.length - MAX_FIELD_VERIFICATIONS)
    : sorted;
}
