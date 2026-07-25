// Shared contact normalization/dedup logic, used identically by every lead
// write path (POST /api/leads, PUT /api/leads/[id], PATCH ... MODIFY) so the
// three routes can't silently diverge in how they treat contacts[] — the
// exact bug this module replaces (see issue #45): each route previously had
// its own near-duplicate normalization, and PATCH MODIFY had none at all.

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

// Previously only POST applied phone/email formatting to contacts[] (a
// separate step in app/api/leads/route.ts) — PUT and PATCH MODIFY wrote
// contacts[] verbatim. Moved here so every write path gets the same
// formatting, closing that inconsistency along with the rest of this module.
export function normalizePhone(phone: string): string {
  if (!phone) return phone;
  const cleaned = phone.replace(/[^\d+]/g, '');
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

export function normalizeContact(c: ContactInput, options?: NormalizeContactOptions): NormalizedContact {
  const rawEmail = typeof c?.email === 'string' ? c.email.trim() : '';
  const rawPhone = typeof c?.phone === 'string' ? c.phone.trim() : '';
  const verify = options?.verify === true;
  const now = options?.now ?? new Date();
  return {
    name: typeof c?.name === 'string' ? c.name.trim() : '',
    title: typeof c?.title === 'string' ? c.title.trim() : '',
    email: rawEmail ? normalizeEmail(rawEmail) : '',
    phone: rawPhone ? normalizePhone(rawPhone) : '',
    linkedin: typeof c?.linkedin === 'string' ? c.linkedin.trim() : '',
    role: typeof c?.role === 'string' ? c.role.trim() : '',
    isDecisionMaker: c?.isDecisionMaker === true,
    lastVerifiedAt: verify ? now.toISOString() : (typeof c?.lastVerifiedAt === 'string' ? c.lastVerifiedAt : undefined),
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
