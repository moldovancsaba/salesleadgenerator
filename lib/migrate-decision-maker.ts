// Shared migration logic for issue #45's hard cutover, used by both the
// standalone script (scripts/migrate-decision-maker-to-contacts.js) and the
// temporary admin endpoint (app/api/admin/migrate-decision-maker/route.ts) —
// one algorithm, not two copies that can drift.
//
// Folds legacy decision_maker_name/decision_maker_title/decision_maker_contact/
// contact_phone top-level fields into a contacts[] entry with
// isDecisionMaker: true, then clears the old fields. Idempotent: a document
// with those fields already empty has nothing to do.

// Legacy top-level fields were never guaranteed to be strings — PUT/PATCH
// MODIFY wrote body[field] verbatim with no coercion before this hard
// cutover (see issue #45), so a caller that ever sent e.g. an object for
// decision_maker_contact would have stored it as-is. Confirmed in real
// production data: a document threw "trim is not a function" here before
// this guard was added. Treat anything non-string as empty rather than
// assume the stored shape matches what the app itself would have written.
function asString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  return /^[+\d][\d\-\s()]{6,}$/.test(value.trim());
}

type RawContact = Record<string, any>;

export type NormalizedMigrationContact = {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  role: string;
  isDecisionMaker: boolean;
};

function normalizeContact(c: RawContact): NormalizedMigrationContact {
  return {
    name: typeof c.name === 'string' ? c.name.trim() : '',
    title: typeof c.title === 'string' ? c.title.trim() : '',
    email: typeof c.email === 'string' ? c.email.trim().toLowerCase() : '',
    phone: typeof c.phone === 'string' ? c.phone.trim() : '',
    linkedin: typeof c.linkedin === 'string' ? c.linkedin.trim() : '',
    role: typeof c.role === 'string' ? c.role.trim() : '',
    isDecisionMaker: c.isDecisionMaker === true,
  };
}

function contactKey(c: NormalizedMigrationContact): string {
  const name = c.name.toLowerCase();
  if (!name) return '';
  if (c.phone) return `${name}|${c.phone}`;
  if (c.email) return `${name}|${c.email}`;
  return name;
}

// decision_maker_contact is free-form (may be an email, a phone, or neither
// — see PIPELINE_ARCHITECTURE.md's historical schema note), so it's only
// assigned to email/phone when it's recognizably one of those.
function buildLegacyContact(doc: Record<string, any>): NormalizedMigrationContact | null {
  const name = asString(doc.decision_maker_name);
  const title = asString(doc.decision_maker_title);
  const rawContact = asString(doc.decision_maker_contact);
  const phone = asString(doc.contact_phone);

  const email = looksLikeEmail(rawContact) ? rawContact : '';
  const resolvedPhone = phone || (looksLikePhone(rawContact) ? rawContact : '');

  if (!name && !email && !resolvedPhone) return null;

  return normalizeContact({ name, title, email, phone: resolvedPhone, linkedin: '', role: '', isDecisionMaker: true });
}

export type MigrationDocResult = {
  id: string;
  outcome: 'merged' | 'already-represented' | 'cleared-only';
};

export type MigrationCollectionResult = {
  scanned: number;
  merged: number;
  alreadyRepresented: number;
  clearedOnly: number;
  docs: MigrationDocResult[];
};

// `db` is a real mongodb driver Db instance (or mongoose's `connection.db`,
// which wraps the same native driver object).
export async function migrateDecisionMakerCollection(
  db: any,
  collectionName: string,
  { apply }: { apply: boolean }
): Promise<MigrationCollectionResult> {
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    $or: [
      { decision_maker_name: { $exists: true, $ne: '' } },
      { decision_maker_contact: { $exists: true, $ne: '' } },
      { decision_maker_title: { $exists: true, $ne: '' } },
      { contact_phone: { $exists: true, $ne: '' } },
    ],
  });

  const result: MigrationCollectionResult = { scanned: 0, merged: 0, alreadyRepresented: 0, clearedOnly: 0, docs: [] };

  for await (const doc of cursor) {
    result.scanned++;
    const legacyContact = buildLegacyContact(doc);
    const existingContacts: NormalizedMigrationContact[] = Array.isArray(doc.contacts) ? doc.contacts.map(normalizeContact) : [];

    let newContacts = existingContacts;
    let outcome: MigrationDocResult['outcome'] = 'cleared-only';

    if (legacyContact) {
      const key = contactKey(legacyContact);
      const alreadyThere = key !== '' && existingContacts.some((c) => contactKey(c) === key);
      if (alreadyThere) {
        result.alreadyRepresented++;
        outcome = 'already-represented';
      } else {
        newContacts = [legacyContact, ...existingContacts];
        result.merged++;
        outcome = 'merged';
      }
    } else {
      result.clearedOnly++;
    }

    result.docs.push({ id: String(doc._id), outcome });

    if (apply) {
      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            contacts: newContacts,
            decision_maker_name: '',
            decision_maker_title: '',
            decision_maker_contact: '',
            contact_phone: '',
          },
        }
      );
    }
  }

  return result;
}
