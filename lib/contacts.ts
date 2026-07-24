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

export function normalizeContact(c: ContactInput): NormalizedContact {
  const rawEmail = typeof c?.email === 'string' ? c.email.trim() : '';
  const rawPhone = typeof c?.phone === 'string' ? c.phone.trim() : '';
  return {
    name: typeof c?.name === 'string' ? c.name.trim() : '',
    title: typeof c?.title === 'string' ? c.title.trim() : '',
    email: rawEmail ? normalizeEmail(rawEmail) : '',
    phone: rawPhone ? normalizePhone(rawPhone) : '',
    linkedin: typeof c?.linkedin === 'string' ? c.linkedin.trim() : '',
    role: typeof c?.role === 'string' ? c.role.trim() : '',
    isDecisionMaker: c?.isDecisionMaker === true,
  };
}

// Dedup key: name+phone preferred (matches how a person is most reliably
// re-identified across separate research passes), falling back to name+email,
// then bare name.
function contactKey(c: NormalizedContact): string {
  const name = c.name.toLowerCase();
  if (!name) return '';
  if (c.phone) return `${name}|${c.phone}`;
  if (c.email) return `${name}|${c.email.toLowerCase()}`;
  return name;
}

export function dedupeContacts(contacts: ContactInput[] | undefined | null): NormalizedContact[] {
  if (!Array.isArray(contacts)) return [];

  const seen = new Set<string>();
  const deduped: NormalizedContact[] = [];

  for (const raw of contacts) {
    const c = normalizeContact(raw);
    if (!c.name && !c.email && !c.phone) continue;
    const key = contactKey(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
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
