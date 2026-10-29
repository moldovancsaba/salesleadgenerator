import { MongoClient, type Db } from 'mongodb';
import fs from 'fs';
import dotenv from 'dotenv';
import { mapListingToPadelLead, type PadelListing } from './padel-listings-sync';

const MANAGEMENT_ENV_PATH = '/Users/Shared/Projects/management/.env.padelafrica.daemon';

export function getPadelAfricaSourceUri(): string | null {
  if (process.env.PADEL_AFRICA_MONGODB_URI) {
    return process.env.PADEL_AFRICA_MONGODB_URI;
  }
  if (fs.existsSync(MANAGEMENT_ENV_PATH)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(MANAGEMENT_ENV_PATH, 'utf8'));
      if (parsed.MONGODB_URI) return parsed.MONGODB_URI;
    } catch {
      // Ignore read error
    }
  }
  return null;
}

export interface SyncPadelResult {
  ok: boolean;
  totalFound: number;
  inserted: number;
  updated: number;
  errors: string[];
}

/**
 * Synchronizes Padel Africa published listings into `padel_africa_leads` in SLG.
 */
export async function syncPadelListingsToLeads(
  slgDb: Db,
  options?: { sourceUri?: string }
): Promise<SyncPadelResult> {
  const padelUri = options?.sourceUri || getPadelAfricaSourceUri();
  if (!padelUri) {
    return {
      ok: false,
      totalFound: 0,
      inserted: 0,
      updated: 0,
      errors: ['PADEL_AFRICA_MONGODB_URI not configured and daemon env unreachable.'],
    };
  }

  let padelClient: MongoClient | null = null;
  const result: SyncPadelResult = {
    ok: true,
    totalFound: 0,
    inserted: 0,
    updated: 0,
    errors: [],
  };

  try {
    padelClient = new MongoClient(padelUri);
    await padelClient.connect();
    const padelDb = padelClient.db('padel-africa');
    const leadsColl = slgDb.collection('padel_africa_leads');

    // Create index on externalSource.listingId if not exists
    await leadsColl.createIndex({ 'externalSource.listingId': 1 });

    const listings = await padelDb
      .collection<PadelListing>('listings')
      .find({ lifecycleState: 'PUBLISHED' })
      .toArray();

    result.totalFound = listings.length;

    // Highest numeric ID tracking
    const maxDoc = await leadsColl.find().sort({ id: -1 }).limit(1).toArray();
    let nextId = (maxDoc[0]?.id || 0) + 1;

    for (const listing of listings) {
      try {
        const existing = await leadsColl.findOne({ 'externalSource.listingId': listing.id });
        const leadData = mapListingToPadelLead(listing, { nextId });

        if (!existing) {
          await leadsColl.insertOne({
            ...leadData,
            id: nextId++,
            createdAt: new Date().toISOString(),
          });
          result.inserted++;
        } else {
          // Preserve CRM state: stage (kanbanColumn), custom notes, user-assigned contacts
          await leadsColl.updateOne(
            { _id: existing._id },
            {
              $set: {
                entity_name: leadData.entity_name,
                url: leadData.url,
                address: leadData.address,
                country: leadData.country,
                region: leadData.region,
                general_contact: leadData.general_contact,
                contact_phone: leadData.contact_phone,
                sportCode: leadData.sportCode,
                value_proposition: leadData.value_proposition,
                ticketSizeEstimate: leadData.ticketSizeEstimate,
                'externalSource.verifiedAt': listing.verifiedAt,
                'externalSource.publishedAt': listing.publishedAt,
                updatedAt: new Date().toISOString(),
              },
            }
          );
          result.updated++;
        }
      } catch (err: any) {
        result.errors.push(`Listing ${listing.id}: ${err.message}`);
      }
    }

    return result;
  } catch (err: any) {
    return {
      ok: false,
      totalFound: 0,
      inserted: 0,
      updated: 0,
      errors: [err.message || String(err)],
    };
  } finally {
    if (padelClient) {
      await padelClient.close().catch(() => {});
    }
  }
}
