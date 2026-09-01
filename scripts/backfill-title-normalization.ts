#!/usr/bin/env npx tsx
// Backfill for issue #68: derives seniorityTier/department for every
// existing contacts[] entry that predates this feature (or whose stored
// values have drifted from what lib/title-normalization.ts's keyword table
// would derive today). Imports the real algorithm from
// lib/backfill-title-normalization.ts directly rather than re-implementing
// it, so there's exactly one copy of this logic — same pattern
// scripts/migrate-decision-maker-to-contacts.ts already established.
//
// Requires a real MONGODB_URI in .env.local — this sandbox has no network
// access to MongoDB Atlas (confirmed blocked, the same documented gap
// affecting every other Mongo-integration path in this repo), so this
// script could not be executed here. It has NOT been run against
// production; that is real, disclosed follow-up work for an environment
// with real DB access, not something claimed as already done.
//
// Usage:
//   npx tsx scripts/backfill-title-normalization.ts            # dry run (default)
//   npx tsx scripts/backfill-title-normalization.ts --apply    # writes changes
//
// Idempotent: safe to re-run. A contact whose stored seniorityTier/
// department already match what normalizeTitle() would derive is skipped.

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import mongoose from 'mongoose';
import { backfillTitleNormalizationCollection } from '../lib/backfill-title-normalization';
import { getAllBrandConfigs } from '../app/lib/brand';

const APPLY = process.argv.includes('--apply');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  // Issue #147 — derived from BRAND_CONFIG's own dbCollection values, not a
  // hardcoded 2-brand array, so a future brand is picked up automatically.
  const COLLECTIONS = Object.values(await getAllBrandConfigs()).map((c) => c.dbCollection);

  console.log(APPLY ? 'Running in APPLY mode — this will write changes.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const totals = { scanned: 0, updated: 0, unchanged: 0, contactsUpdated: 0 };

  for (const collectionName of COLLECTIONS) {
    console.log(`--- ${collectionName} ---`);
    const result = await backfillTitleNormalizationCollection(db, collectionName, { apply: APPLY });
    for (const d of result.docs) {
      if (d.outcome === 'updated') {
        console.log(`${APPLY ? 'UPDATE' : 'DRY-RUN'} ${collectionName}/${d.id}: ${d.outcome} (${d.contactsUpdated} contact(s))`);
      }
    }
    console.log(`${collectionName}: scanned=${result.scanned} updated=${result.updated} unchanged=${result.unchanged} contactsUpdated=${result.contactsUpdated}\n`);
    totals.scanned += result.scanned;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    totals.contactsUpdated += result.contactsUpdated;
  }

  console.log('=== Totals ===');
  console.log(`Documents scanned: ${totals.scanned}`);
  console.log(`Documents updated: ${totals.updated}`);
  console.log(`Documents unchanged: ${totals.unchanged}`);
  console.log(`Contacts backfilled: ${totals.contactsUpdated}`);

  if (!APPLY && totals.scanned > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
