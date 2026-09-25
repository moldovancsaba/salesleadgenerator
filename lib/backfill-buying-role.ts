// Backfill for issue #206: existing lead documents were written before
// buyingRole existed, so their stored contacts[] entries lack it (or carry
// a stale isDecisionMaker-only classification). Idempotent by construction
// — re-running finds contactsUpdated: 0 for any contact whose derived
// values already match, mirroring lib/backfill-title-normalization.ts's
// exact shape and the same apply/dry-run split. Correctness does not depend
// on running this — normalizeContact() re-derives both fields lazily on
// every subsequent write (same lazy-derivation convention seniorityTier/
// department already use); this exists purely for stored-data consistency
// and reporting, per that file's own precedent.

import { resolveBuyingRole, deriveIsDecisionMaker } from './contacts';

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
// lib/backfill-title-normalization.ts's own function.
export async function backfillBuyingRoleCollection(
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
      const resolvedRole = resolveBuyingRole(c);
      const resolvedIsDM = deriveIsDecisionMaker(resolvedRole);
      if (c?.buyingRole !== resolvedRole || c?.isDecisionMaker !== resolvedIsDM) {
        contactsUpdated++;
        return { ...c, buyingRole: resolvedRole, isDecisionMaker: resolvedIsDM };
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
