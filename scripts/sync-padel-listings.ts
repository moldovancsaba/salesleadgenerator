#!/usr/bin/env npx tsx
/**
 * Synchronizes Padel Africa published directory listings into `padel_africa_leads` collection in SLG.
 *
 * Requirements:
 * - Reads published directory listings from Padel Africa database (padelafrica.6yaayde.mongodb.net/padel-africa)
 *   using credentials in /Users/Shared/Projects/management/.env.padelafrica.daemon or PADEL_AFRICA_MONGODB_URI.
 * - Idempotently maps and upserts each listing to `padel_africa_leads` in SLG (MONGODB_URI in .env.local).
 * - Enforces that for brand `padel-africa`, all leads originate strictly and exclusively from these directory listings.
 *
 * Usage:
 *   npx tsx scripts/sync-padel-listings.ts          # Dry-run inspection
 *   npx tsx scripts/sync-padel-listings.ts --apply  # Execute upserts to database
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { MongoClient } from 'mongodb';
import { mapListingToPadelLead, type PadelListing } from '../lib/padel-listings-sync';

const APPLY = process.argv.includes('--apply');
const MANAGEMENT_ENV_PATH = '/Users/Shared/Projects/management/.env.padelafrica.daemon';

function getPadelAfricaSourceUri(): string {
  if (process.env.PADEL_AFRICA_MONGODB_URI) {
    return process.env.PADEL_AFRICA_MONGODB_URI;
  }
  if (fs.existsSync(MANAGEMENT_ENV_PATH)) {
    const parsed = dotenv.parse(fs.readFileSync(MANAGEMENT_ENV_PATH, 'utf8'));
    if (parsed.MONGODB_URI) return parsed.MONGODB_URI;
  }
  throw new Error(`PADEL_AFRICA_MONGODB_URI not set and could not find URI in ${MANAGEMENT_ENV_PATH}`);
}

async function main() {
  const slgUri = process.env.MONGODB_URI;
  if (!slgUri) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  const padelUri = getPadelAfricaSourceUri();
  console.log(APPLY ? 'Running in APPLY mode — syncing listings to padel_africa_leads.' : 'Running in DRY-RUN mode — pass --apply to write.');

  console.log('Connecting to Padel Africa source database...');
  const padelClient = new MongoClient(padelUri);
  await padelClient.connect();
  const padelDb = padelClient.db('padel-africa');

  console.log('Connecting to SLG target database...');
  const slgClient = new MongoClient(slgUri);
  await slgClient.connect();
  const slgDb = slgClient.db();
  const leadsColl = slgDb.collection('padel_africa_leads');

  // Fetch all published listings
  const listings = await padelDb.collection<PadelListing>('listings').find({ lifecycleState: 'PUBLISHED' }).toArray();
  console.log(`Found ${listings.length} published listings in Padel Africa directory.`);

  // Get current highest numeric id in padel_africa_leads
  const highestLead = await leadsColl.find({ id: { $exists: true } }, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).toArray();
  let nextId = (highestLead[0]?.id || 0) + 1;

  let insertedCount = 0;
  let updatedCount = 0;

  for (const listing of listings) {
    // Check if lead already exists by listingId or fingerprint
    const existing = await leadsColl.findOne({
      $or: [
        { 'externalSource.listingId': listing.id },
        { 'externalSource.listingId': String(listing.id) },
      ],
    });

    const leadId = existing?.id || nextId++;
    const leadDoc = mapListingToPadelLead(listing, { nextId: leadId });

    if (existing) {
      if (APPLY) {
        await leadsColl.updateOne(
          { _id: existing._id },
          {
            $set: {
              ...leadDoc,
              id: existing.id,
              kanbanColumn: existing.kanbanColumn || leadDoc.kanbanColumn, // Preserve operator stage progress
              notes: existing.notes || leadDoc.notes,
              updatedAt: new Date().toISOString(),
            },
          }
        );
      }
      updatedCount++;
    } else {
      if (APPLY) {
        await leadsColl.insertOne(leadDoc);
      }
      insertedCount++;
    }
  }

  if (APPLY) {
    // Ensure index on externalSource.listingId, country, and kanbanColumn
    await leadsColl.createIndex({ 'externalSource.listingId': 1 }, { unique: true, sparse: true });
    await leadsColl.createIndex({ id: 1 }, { unique: true, sparse: true });
    await leadsColl.createIndex({ kanbanColumn: 1 });
    await leadsColl.createIndex({ country: 1 });
  }

  console.log('\n--- Sync Summary ---');
  console.log(`Total Published Listings: ${listings.length}`);
  console.log(`New Leads Inserted: ${insertedCount}`);
  console.log(`Existing Leads Updated: ${updatedCount}`);
  console.log(APPLY ? 'Database updated successfully.' : 'Dry-run finished. No writes made.');

  await padelClient.close();
  await slgClient.close();
}

main().catch((err) => {
  console.error('Fatal error syncing listings:', err);
  process.exit(1);
});
