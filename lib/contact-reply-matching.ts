// Issue #142 — matches an inbound-email reply (issue #141's webhook) to the
// lead it came from via contactEmails[], and generates a contact-enrichment
// suggestion when the reply's signature block reveals a changed detail.
// Never auto-writes contacts[] — matches this repo's established
// never-auto-merge stance (issue #137: duplicate leads are reported, not
// auto-merged; reviewed via /admin/duplicates instead).

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { getBrandConfig, type Brand } from '../app/lib/brand';
import { tenantFilter } from './tenant';
import {
  normalizeEmail,
  normalizeContact,
  dedupeContacts,
  contactKey,
  ensureContactEmailsIndex,
  type NormalizedContact,
} from './contacts';
import { parseSignatureBlock } from './signature-parser';

export const CONTACT_SUGGESTIONS_COLLECTION = 'contactSuggestions';

export type ContactSuggestionFields = {
  name?: string;
  title?: string;
  phone?: string;
};

export type ContactSuggestionDocument = {
  leadId: string;
  brand: string;
  tenantId: string;
  matchedContactKey: string;
  // The contact's currently-stored values, alongside `suggested` — lets the
  // UI show a real before/after, not just the new value in isolation.
  current: ContactSuggestionFields;
  suggested: ContactSuggestionFields;
  sourceActivityLogId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  resolvedAt?: Date;
};

export type ReplyMatchResult =
  | { kind: 'no-match' }
  | { kind: 'single-match'; leadId: string }
  | { kind: 'multi-match'; leadIds: string[] };

// Looks up which lead(s), if any, have `senderEmail` in their contactEmails[]
// index. Email is treated as an exact identifier (normalizeEmail() only,
// never fuzzy-matched) — per issue #142's own non-goals, a reply from an
// unlisted address for an otherwise-known person is unmatched, not guessed.
export async function matchReplyToLeads(
  db: Db,
  brand: Brand,
  tenantId: string,
  senderEmail: string
): Promise<ReplyMatchResult> {
  const email = normalizeEmail(senderEmail);
  if (!email) return { kind: 'no-match' };

  const config = await getBrandConfig(brand);
  if (!config) return { kind: 'no-match' };
  await ensureContactEmailsIndex(db, config.dbCollection);

  const filter = { ...tenantFilter(tenantId), contactEmails: email };
  // Capped at 10 — a real address genuinely listed as a contact on more
  // than a handful of leads (e.g. an agency contact) is already an
  // unusual shape; this is a sanity bound, not an expected common case.
  const matches = await db
    .collection(config.dbCollection)
    .find(filter, { projection: { _id: 1 } })
    .limit(10)
    .toArray();

  if (matches.length === 0) return { kind: 'no-match' };
  if (matches.length === 1) return { kind: 'single-match', leadId: matches[0]._id.toString() };
  return { kind: 'multi-match', leadIds: matches.map((m: any) => m._id.toString()) };
}

// Re-finds the specific contact within a matched lead's contacts[] that owns
// `senderEmail` — shared by the caller (to stamp ActivityLogDocument's
// matchedContactKey) and generateContactSuggestion below, so both read the
// exact same lookup rather than two independent implementations drifting.
export async function findMatchedContact(
  db: Db,
  brand: Brand,
  tenantId: string,
  leadId: string,
  senderEmail: string
): Promise<NormalizedContact | null> {
  const config = await getBrandConfig(brand);
  if (!config) return null;
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(leadId);
  } catch {
    return null;
  }
  const lead = await db.collection(config.dbCollection).findOne({ _id: objectId, ...tenantFilter(tenantId) });
  if (!lead) return null;

  const email = normalizeEmail(senderEmail);
  const existingContacts = dedupeContacts(lead.contacts || []);
  return existingContacts.find((c) => c.email === email) || null;
}

// Finds the index of the contact in contacts[] that corresponds to a suggestion's
// matchedContactKey. Resilient to contact edits (such as name normalization or
// adding a last name, e.g. "Dávid" -> "Dávid Bozsik") that occurred between when
// the suggestion was generated and when the user accepts it.
export function findMatchingContactIndex(
  contacts: NormalizedContact[],
  matchedContactKey: string,
  current?: ContactSuggestionFields
): number {
  if (!contacts || contacts.length === 0) return -1;

  // 1. Exact contactKey match (fast path)
  const exactIdx = contacts.findIndex((c) => contactKey(c) === matchedContactKey);
  if (exactIdx !== -1) return exactIdx;

  // 2. Parse matchedContactKey: format is typically "name|email" or "name|phone" or "name"
  const parts = (matchedContactKey || '').split('|');
  const keyName = parts[0]?.trim().toLowerCase();
  const keyDetail = parts.slice(1).join('|').trim();

  // If keyDetail contains an email, match by email
  if (keyDetail && keyDetail.includes('@')) {
    const normEmail = keyDetail.toLowerCase();
    const emailIdx = contacts.findIndex((c) => c.email && c.email.toLowerCase().trim() === normEmail);
    if (emailIdx !== -1) return emailIdx;
  }

  // If keyDetail is a phone number, match by phone digits
  if (keyDetail && !keyDetail.includes('@')) {
    const cleanKeyPhone = keyDetail.replace(/\D/g, '');
    if (cleanKeyPhone.length >= 6) {
      const phoneIdx = contacts.findIndex((c) => {
        if (!c.phone) return false;
        const cleanCPhone = c.phone.replace(/\D/g, '');
        return (
          cleanCPhone === cleanKeyPhone ||
          (cleanCPhone.length >= 7 && cleanKeyPhone.endsWith(cleanCPhone)) ||
          (cleanKeyPhone.length >= 7 && cleanCPhone.endsWith(cleanKeyPhone))
        );
      });
      if (phoneIdx !== -1) return phoneIdx;
    }
  }

  // 3. Name-based matching (handles name drift, e.g. "Dávid" vs "Dávid Bozsik")
  const candidateNames = [
    keyName,
    current?.name?.trim().toLowerCase(),
  ].filter(Boolean) as string[];

  for (const nameToMatch of candidateNames) {
    if (!nameToMatch) continue;
    // Direct match (case-insensitive)
    const nameIdx = contacts.findIndex((c) => c.name?.trim().toLowerCase() === nameToMatch);
    if (nameIdx !== -1) return nameIdx;

    // Substring or token match (e.g. "dávid" in "dávid bozsik", or "dávid bozsik" has tokens of "dávid")
    const tokenIdx = contacts.findIndex((c) => {
      const cName = c.name?.trim().toLowerCase();
      if (!cName) return false;
      const cTokens = cName.split(/\s+/);
      const matchTokens = nameToMatch.split(/\s+/);
      return matchTokens.every((t) => cTokens.includes(t)) || cTokens.every((t) => matchTokens.includes(t));
    });
    if (tokenIdx !== -1) return tokenIdx;
  }

  // 4. Current phone matching if provided
  if (current?.phone) {
    const cleanCurPhone = current.phone.replace(/\D/g, '');
    if (cleanCurPhone.length >= 6) {
      const phoneIdx = contacts.findIndex((c) => c.phone && c.phone.replace(/\D/g, '') === cleanCurPhone);
      if (phoneIdx !== -1) return phoneIdx;
    }
  }

  // 5. Single contact fallback: if the lead only has 1 contact, this suggestion belongs to it
  if (contacts.length === 1) {
    return 0;
  }

  return -1;
}

function diffSuggestedFields(
  existing: NormalizedContact,
  candidate: NormalizedContact
): { current: ContactSuggestionFields; suggested: ContactSuggestionFields } | null {
  const suggested: ContactSuggestionFields = {};
  const current: ContactSuggestionFields = {};

  if (candidate.name && candidate.name !== existing.name) {
    suggested.name = candidate.name;
    current.name = existing.name || undefined;
  }
  if (candidate.title && candidate.title !== existing.title) {
    suggested.title = candidate.title;
    current.title = existing.title || undefined;
  }
  if (candidate.phone && candidate.phone !== existing.phone) {
    suggested.phone = candidate.phone;
    current.phone = existing.phone || undefined;
  }

  if (Object.keys(suggested).length === 0) return null;
  return { current, suggested };
}

// Parses the reply's signature block and, if it reveals a genuinely changed
// detail versus the matched contact's stored values, writes a pending
// suggestion (never a direct contacts[] write). Returns null when there's
// nothing to suggest — no signature found, or the parsed values match what's
// already stored. Idempotent per sourceActivityLogId is the caller's
// responsibility (the webhook route's own externalId-uniqueness already
// prevents this from running twice for the same inbound email).
export async function generateContactSuggestion(
  db: Db,
  brand: Brand,
  tenantId: string,
  leadId: string,
  senderEmail: string,
  bodyText: string | undefined,
  sourceActivityLogId: string,
  // Optional — pass the already-looked-up contact (the webhook route
  // already calls findMatchedContact() once to stamp matchedContactKey) to
  // avoid a second identical query. Re-looked-up when omitted.
  matchedContact?: NormalizedContact | null
): Promise<ContactSuggestionDocument | null> {
  const parsed = parseSignatureBlock(bodyText);
  if (!parsed) return null;

  const contact = matchedContact ?? (await findMatchedContact(db, brand, tenantId, leadId, senderEmail));
  // Matched via contactEmails[] but the individual contact isn't found —
  // shouldn't happen (the index is derived from the same contacts[] this
  // reads), but defensive rather than throwing on a data-consistency edge case.
  if (!contact) return null;

  const candidate = normalizeContact({
    name: parsed.name,
    title: parsed.title,
    phone: parsed.phone,
  });

  const diff = diffSuggestedFields(contact, candidate);
  if (!diff) return null;

  const doc: ContactSuggestionDocument = {
    leadId,
    brand,
    tenantId,
    matchedContactKey: contactKey(contact),
    current: diff.current,
    suggested: diff.suggested,
    sourceActivityLogId,
    status: 'pending',
    createdAt: new Date(),
  };
  await db.collection(CONTACT_SUGGESTIONS_COLLECTION).insertOne(doc as any);
  return doc;
}

let suggestionsIndexEnsured = false;
export async function ensureContactSuggestionsIndexes(db: Db): Promise<void> {
  if (suggestionsIndexEnsured) return;
  try {
    const collection = db.collection(CONTACT_SUGGESTIONS_COLLECTION);
    await collection.createIndex({ leadId: 1, status: 1, createdAt: -1 });
    suggestionsIndexEnsured = true;
  } catch (error) {
    console.error('[contact-reply-matching] contactSuggestions index creation failed', error);
  }
}
