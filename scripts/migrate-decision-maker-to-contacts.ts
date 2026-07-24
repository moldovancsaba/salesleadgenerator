#!/usr/bin/env npx tsx
// One-time production migration for issue #45's hard cutover. Imports the
// real algorithm from lib/migrate-decision-maker.ts directly (run via tsx,
// already a devDependency — see tests/smoke/*.smoke.ts for the same
// pattern) rather than re-implementing it, so there's exactly one copy of
// this logic, shared with the temporary admin endpoint
// (app/api/admin/migrate-decision-maker/route.ts).
//
// MUST be run against real production data before (or atomically with)
// deploying the code in this change — see GitHub issue #45's "Production
// data migration" section. Skipping it means any lead whose decision-maker
// data lives ONLY in the top-level fields (anything edited via PUT or
// PATCH MODIFY since creation, per the bypass bug this change fixes) will
// have that data become invisible the moment the new code ships, with no
// error or warning.
//
// This sandbox has no MONGODB_URI and — separately, confirmed by direct
// test — no network path to MongoDB Atlas (TCP to port 27017 times out) or
// to the deployed app itself (HTTPS CONNECT to salesleadgenerator.vercel.app
// returns 403, same policy class as github.com). Could not run this
// directly; the admin endpoint is the alternative that actually reaches
// production, since it runs inside Vercel's own network.
//
// Usage:
//   npx tsx scripts/migrate-decision-maker-to-contacts.ts            # dry run (default)
//   npx tsx scripts/migrate-decision-maker-to-contacts.ts --apply    # writes changes
//
// Idempotent: safe to re-run. Once a document's old fields are cleared,
// it's skipped on subsequent runs.

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import mongoose from 'mongoose';
import { migrateDecisionMakerCollection } from '../lib/migrate-decision-maker';

const APPLY = process.argv.includes('--apply');
const COLLECTIONS = ['leads', 'seyu_leads'];

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  console.log(APPLY ? 'Running in APPLY mode — this will write changes.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const totals = { scanned: 0, merged: 0, alreadyRepresented: 0, clearedOnly: 0 };

  for (const collectionName of COLLECTIONS) {
    console.log(`--- ${collectionName} ---`);
    const result = await migrateDecisionMakerCollection(db, collectionName, { apply: APPLY });
    for (const d of result.docs) {
      console.log(`${APPLY ? 'UPDATE' : 'DRY-RUN'} ${collectionName}/${d.id}: ${d.outcome}`);
    }
    console.log(`${collectionName}: scanned=${result.scanned} merged=${result.merged} alreadyRepresented=${result.alreadyRepresented} clearedOnly=${result.clearedOnly}\n`);
    totals.scanned += result.scanned;
    totals.merged += result.merged;
    totals.alreadyRepresented += result.alreadyRepresented;
    totals.clearedOnly += result.clearedOnly;
  }

  console.log('=== Totals ===');
  console.log(`Documents scanned: ${totals.scanned}`);
  console.log(`New contacts[] entries merged: ${totals.merged}`);
  console.log(`Already represented (dedup skipped): ${totals.alreadyRepresented}`);
  console.log(`Cleared with nothing to merge: ${totals.clearedOnly}`);

  if (!APPLY && totals.scanned > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
