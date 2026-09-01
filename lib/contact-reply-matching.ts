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
