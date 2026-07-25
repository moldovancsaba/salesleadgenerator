// Backfill for issue #68: existing lead documents were written before
// seniorityTier/department existed, so their stored contacts[] entries lack
// both fields (or, after a partial run, may already have stale values if
// the keyword table changes in the future). Idempotent by construction —
// re-running finds contactsUpdated: 0 for any contact whose derived values
// already match, mirroring lib/migrate-decision-maker.ts's shape and the
// same apply/dry-run split.

import { normalizeTitle } from './title-normalization';

export type BackfillDocResult = {
  id: string;
  outcome: 'updated' | 'unchanged';
  contactsUpdated: number;
};

export type BackfillCollectionResult = {
  scanned: number;
  updated: number;
  unchanged: number;
  contactsUpdated: number;
  docs: BackfillDocResult[];
};

// `db` is a real mongodb driver Db instance (or mongoose's `connection.db`,
// which wraps the same native driver object) — same convention as
// lib/migrate-decision-maker.ts's migrateDecisionMakerCollection().
export async function backfillTitleNormalizationCollection(
  db: any,
  collectionName: string,
  { apply }: { apply: boolean }
): Promise<BackfillCollectionResult> {
  const collection = db.collection(collectionName);
  const cursor = collection.find({ contacts: { $exists: true, $not: { $size: 0 } } });

  const result: BackfillCollectionResult = { scanned: 0, updated: 0, unchanged: 0, contactsUpdated: 0, docs: [] };

  for await (const doc of cursor) {
    result.scanned++;
    const contacts: any[] = Array.isArray(doc.contacts) ? doc.contacts : [];
    let contactsUpdated = 0;

    const newContacts = contacts.map((c) => {
      const rawTitle = typeof c?.title === 'string' ? c.title : '';
      const { seniorityTier, department } = normalizeTitle(rawTitle);
      if (c?.seniorityTier !== seniorityTier || c?.department !== department) {
        contactsUpdated++;
        return { ...c, seniorityTier, department };
      }
      return c;
    });

    if (contactsUpdated > 0) {
      result.updated++;
      result.contactsUpdated += contactsUpdated;
      result.docs.push({ id: String(doc._id), outcome: 'updated', contactsUpdated });
      if (apply) {
        await collection.updateOne({ _id: doc._id }, { $set: { contacts: newContacts } });
      }
    } else {
      result.unchanged++;
      result.docs.push({ id: String(doc._id), outcome: 'unchanged', contactsUpdated: 0 });
    }
  }

  return result;
}
