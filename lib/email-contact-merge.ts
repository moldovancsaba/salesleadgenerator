import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { getBrandConfig } from '../app/lib/brand';
import { tenantFilter } from './tenant';
import {
  dedupeContacts,
  deriveContactEmails,
  type NormalizedContact,
} from './contacts';
import { isInternalOrSystemEmail } from './email-contact-extractor';

/**
 * Merges candidate contacts into a Lead document in MongoDB, deduplicating and updating
 * contacts[] and contactEmails[] indexes automatically. Internal team emails are strictly excluded.
 */
export async function mergeContactsIntoLead(
  db: Db,
  brand: string,
  tenantId: string,
  leadId: string,
  candidateContacts: NormalizedContact[]
): Promise<{ added: number; updated: number; contacts: NormalizedContact[] } | null> {
  if (!candidateContacts || candidateContacts.length === 0) return null;

  // Strictly filter out internal company domains, bots, and system emails
  const filteredCandidates = candidateContacts.filter(
    (c) => c?.email && !isInternalOrSystemEmail(c.email, { brand })
  );
  if (filteredCandidates.length === 0) return null;

  const brandConfig = await getBrandConfig(brand).catch(() => null);
  if (!brandConfig) return null;

  const collectionName = brandConfig.dbCollection || 'leads';
  let objectId: ObjectId | null = null;
  const orClauses: any[] = [{ id: leadId }];
  const num = Number(leadId);
  if (!Number.isNaN(num)) orClauses.push({ id: num });
  if (ObjectId.isValid(leadId)) {
    try {
      objectId = new ObjectId(leadId);
      orClauses.push({ _id: objectId });
    } catch {
      // ignore
    }
  }

  const existingLead = await db.collection(collectionName).findOne({
    $or: orClauses,
    ...tenantFilter(tenantId),
  });

  if (!existingLead) return null;

  const currentContacts = Array.isArray(existingLead.contacts) ? [...existingLead.contacts] : [];
  let addedCount = 0;
  let updatedCount = 0;

  for (const candidate of filteredCandidates) {
    const existingIndex = currentContacts.findIndex(
      (c: any) => c?.email && c.email.toLowerCase() === candidate.email.toLowerCase()
    );

    if (existingIndex >= 0) {
      const existing = currentContacts[existingIndex];
      let changed = false;
      const updated = { ...existing };

      if ((!existing.title || existing.title === '') && candidate.title) {
        updated.title = candidate.title;
        changed = true;
      }
      if ((!existing.phone || existing.phone === '') && candidate.phone) {
        updated.phone = candidate.phone;
        changed = true;
      }
      if ((!existing.name || existing.name === 'Valued Contact') && candidate.name && candidate.name !== 'Valued Contact') {
        updated.name = candidate.name;
        changed = true;
      }

      if (changed) {
        currentContacts[existingIndex] = updated;
        updatedCount++;
      }
    } else {
      currentContacts.push(candidate);
      addedCount++;
    }
  }

  if (addedCount === 0 && updatedCount === 0) {
    return {
      added: 0,
      updated: 0,
      contacts: dedupeContacts(currentContacts),
    };
  }

  const finalContacts = dedupeContacts(currentContacts);
  const contactEmails = deriveContactEmails(finalContacts);
  const now = new Date();

  await db.collection(collectionName).updateOne(
    { _id: existingLead._id },
    {
      $set: {
        contacts: finalContacts,
        contactEmails,
        updatedAt: now,
      },
    }
  );

  return {
    added: addedCount,
    updated: updatedCount,
    contacts: finalContacts,
  };
}
