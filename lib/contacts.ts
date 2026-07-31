// Shared contact normalization/dedup logic, used identically by every lead
// write path (POST /api/leads, PUT /api/leads/[id], PATCH ... MODIFY) so the
// three routes can't silently diverge in how they treat contacts[] — the
// exact bug this module replaces (see issue #45): each route previously had
// its own near-duplicate normalization, and PATCH MODIFY had none at all.

import type { EmailVerificationStatus } from './email-verification';
import { normalizeTitle } from './title-normalization';
import type { SeniorityTier, Department } from './title-normalization';

export type ContactInput = Record<string, any>;

export type NormalizedContact = {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  role: string;
  isDecisionMaker: boolean;
  // ISO timestamp of the last time this contact's verifiable fields (email,
  // phone, linkedin, title, role) were confirmed accurate — see issue #66.
  // Undefined means never verified, not "verified at record creation."
  lastVerifiedAt?: string;
  // MX-based domain-deliverability signal (issue #67) — written back
  // asynchronously by write paths after insert/update, never computed
  // synchronously here. Undefined means never checked yet, distinct from
  // status: 'unverified' (checked, but the email failed format validation).
  emailVerificationStatus?: EmailVerificationStatus;
  // Rule-based, derived from `title` on every normalize — see
  // lib/title-normalization.ts, issue #68. Not user-editable; re-derived
  // from whatever `title` is, every time, so it can never silently drift
  // from the title it describes.
  seniorityTier: SeniorityTier;
  department: Department;
};

export type NormalizeContactOptions = {
  // Unconditionally stamp lastVerifiedAt = now, regardless of the input's
  // own lastVerifiedAt. Used by write paths (POST, PUT) that only ever see
  // a fully-fresh or agent-confirmed payload. When false (default), the
  // caller's own lastVerifiedAt is passed through unchanged — diffing
  // against prior state to decide whether a contact should be re-stamped
  // is the caller's responsibility (e.g. PATCH MODIFY in
  // app/lib/lead-actions.ts), not this module's.
  verify?: boolean;
  now?: Date;
};

// Extension notation ("ext. 5", "ext5", "x54", "#54", ",54") must never reach
// the digit-stripping below as part of the dialable number — issue #133,
// found live 2026-07-28: "+1-804-823-9191 ext. 5" was silently normalized to
// "+180482391915", a real but wrong number (the extension digit fused onto
// the subscriber number). The negative lookbehind keeps this from matching
// inside an ordinary word ("extra", "text") — it requires the character
// immediately before the marker to not be a letter, so "1234567x54"
// (extension with no separator, a real business-card convention) still
// matches correctly via its preceding digit, while "extra54" does not.
const EXTENSION_MARKER_RE = /(?<![a-z])(?:ext(?:ension)?\.?|x\.?)\s*\d+|[#,]+\s*\d+/i;

// Previously only POST applied phone/email formatting to contacts[] (a
// separate step in app/api/leads/route.ts) — PUT and PATCH MODIFY wrote
// contacts[] verbatim. Moved here so every write path gets the same
// formatting, closing that inconsistency along with the rest of this module.
export function normalizePhone(phone: string): string {
  if (!phone) return phone;
  // Truncate at the first recognized extension marker before any
  // digit-stripping — the extension itself is dropped, not preserved.
  // Callers that need to keep it should carry it in a separate field
  // (contacts[].role, notes), per docs/LEAD_ENRICHMENT_GUIDE.md's
  // phone-format guidance.
  const extMatch = EXTENSION_MARKER_RE.exec(phone);
  const withoutExtension = extMatch ? phone.slice(0, extMatch.index) : phone;
  const cleaned = withoutExtension.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return '+1' + cleaned; // Assume US
  }
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  return '+' + cleaned;
}

export function normalizeEmail(email: string): string {
  if (!email) return email;
  return email.toLowerCase().trim();
}

// Title-cases a contact name (issue #96) — lowercases everything, then
// capitalizes the first letter of each word, where "word" boundaries are
// whitespace, hyphens, and apostrophes: "JOHN SMITH" -> "John Smith",
// "anne-marie" -> "Anne-Marie", "o'brien" -> "O'Brien".
//
// Known v1 simplifications, documented rather than silently under-delivered
// (per issue #96's own recommendation not to build a heuristic that would
// still be wrong for names it doesn't anticipate):
// - Already-correct mixed-case names ("McDonald", "DiCaprio") are flattened
//   to "Mcdonald"/"Dicaprio" — no Mc/Mac/Di prefix detection.
// - Name particles ("van der berg", "de la cruz") are capitalized like every
//   other word rather than kept lowercase per locale/family convention —
//   this app has no data to decide otherwise.
export function toNameCase(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_match, boundary, letter) => boundary + letter.toUpperCase());
}

export function normalizeContact(c: ContactInput, options?: NormalizeContactOptions): NormalizedContact {
  const rawEmail = typeof c?.email === 'string' ? c.email.trim() : '';
  const rawPhone = typeof c?.phone === 'string' ? c.phone.trim() : '';
  const title = typeof c?.title === 'string' ? c.title.trim() : '';
  const verify = options?.verify === true;
  const now = options?.now ?? new Date();
  const { seniorityTier, department } = normalizeTitle(title);
  return {
    name: typeof c?.name === 'string' ? toNameCase(c.name.trim()) : '',
    title,
    email: rawEmail ? normalizeEmail(rawEmail) : '',
    phone: rawPhone ? normalizePhone(rawPhone) : '',
    linkedin: typeof c?.linkedin === 'string' ? c.linkedin.trim() : '',
    role: typeof c?.role === 'string' ? c.role.trim() : '',
    isDecisionMaker: c?.isDecisionMaker === true,
    seniorityTier,
    department,
    lastVerifiedAt: verify ? now.toISOString() : (typeof c?.lastVerifiedAt === 'string' ? c.lastVerifiedAt : undefined),
    // Passed through as-is when present — this is a server-computed field
    // (issue #67's background MX check), never something a write payload is
    // expected to set. Write paths that detect the email itself changed are
    // responsible for clearing/re-verifying it; normalizeContact just avoids
    // silently dropping an already-computed result on every re-normalize
    // (e.g. PATCH MODIFY's existing.contacts pass in app/lib/lead-actions.ts).
    emailVerificationStatus: c?.emailVerificationStatus,
  };
}

// Dedup key: name+phone preferred (matches how a person is most reliably
// re-identified across separate research passes), falling back to name+email,
// then bare name. Exported for callers (e.g. app/lib/lead-actions.ts's
// PATCH MODIFY) that need to match an incoming contact against a lead's
// already-stored contacts[] to decide whether it changed.
export function contactKey(c: NormalizedContact): string {
  const name = c.name.toLowerCase();
  if (!name) return '';
  if (c.phone) return `${name}|${c.phone}`;
  if (c.email) return `${name}|${c.email.toLowerCase()}`;
  return name;
}

const VERIFIABLE_FIELDS = ['email', 'phone', 'linkedin', 'title', 'role'] as const;

// Whether `b`'s verifiable fields differ from `a` (the previously-stored
// contact) — the signal that a contact was genuinely re-confirmed, not just
// carried over unchanged in a MODIFY payload. No prior match (`a` undefined)
// always counts as changed.
export function verifiableFieldsDiffer(a: NormalizedContact | undefined | null, b: NormalizedContact): boolean {
  if (!a) return true;
  return VERIFIABLE_FIELDS.some((field) => a[field] !== b[field]);
}

function laterTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export function dedupeContacts(
  contacts: ContactInput[] | undefined | null,
  options?: NormalizeContactOptions
): NormalizedContact[] {
  if (!Array.isArray(contacts)) return [];

  const indexByKey = new Map<string, number>();
  const deduped: NormalizedContact[] = [];

  for (const raw of contacts) {
    const c = normalizeContact(raw, options);
    if (!c.name && !c.email && !c.phone) continue;
    const key = contactKey(c);
    if (!key) continue;

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(c);
      continue;
    }

    // Collision: keep the first-seen entry's fields (existing behavior) but
    // the surviving lastVerifiedAt is the later of the two, not "first
    // seen" — a later duplicate can carry a more recent re-verification.
    const existing = deduped[existingIndex];
    const merged = laterTimestamp(existing.lastVerifiedAt, c.lastVerifiedAt);
    if (merged !== existing.lastVerifiedAt) {
      deduped[existingIndex] = { ...existing, lastVerifiedAt: merged };
    }
  }

  return deduped;
}

// The contact flagged as the decision maker, if any. Multiple contacts may
// carry the flag (e.g. co-decision-makers) — this returns the first, matching
// how routing/ease-scoring only ever need one representative contact.
export function getDecisionMakerContact(
  contacts: ContactInput[] | undefined | null
): NormalizedContact | null {
  if (!Array.isArray(contacts)) return null;
  const dm = contacts.find((c) => c && c.isDecisionMaker === true);
  return dm ? normalizeContact(dm) : null;
}

export type ContactDirectoryEntry = {
  key: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  isDecisionMaker: boolean;
  leads: Array<{ leadId: string; entity_name: string }>;
};

// Cross-lead contact directory (issue #139) — contacts[] has never had a
// concept of identity beyond a single lead's own array (contactKey() below
// is deliberately scoped to one lead). This groups by that same key across
// every lead passed in, so the same person listed on two leads collapses
// into one directory entry with both leads attached, while two different
// people who happen to share only a name (no matching phone/email) do not
// collapse — contactKey() already encodes that distinction.
//
// A contact with no name is excluded (contactKey() returns '' for those,
// same as dedupeContacts()) — there's nothing to search/display by name for
// a directory whose only listing key is the name.
export function aggregateContactsAcrossLeads(
  leads: Array<{ _id: string; entity_name: string; contacts?: ContactInput[] | null }>
): ContactDirectoryEntry[] {
  const byKey = new Map<string, ContactDirectoryEntry>();

  for (const lead of leads) {
    const leadId = lead._id;
    const entityName = lead.entity_name || '';
    for (const c of dedupeContacts(lead.contacts)) {
      const key = contactKey(c);
      if (!key) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (!existing.leads.some((l) => l.leadId === leadId)) {
          existing.leads.push({ leadId, entity_name: entityName });
        }
        continue;
      }

      byKey.set(key, {
        key,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isDecisionMaker: c.isDecisionMaker,
        leads: [{ leadId, entity_name: entityName }],
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}
