#!/usr/bin/env npx tsx
// One-time migration for issue #195: seeds the new `brands` Mongo collection
// with cogmap/seyu/dvsc's real current config, exactly matching
// app/lib/brand.ts's FALLBACK_BRAND_CONFIG (which is retained purely as
// this script's seed data plus the in-code fallback used when `brands` is
// empty — see that file's own header comment). Once this has run, the
// `brands` collection becomes the live, authoritative source for every
// brand it contains; FALLBACK_BRAND_CONFIG is no longer consulted for a
// slug that exists in Mongo.
//
// Idempotent: re-running skips any slug that's already present rather than
// overwriting it, so it's safe to run again after a partial failure, and
// safe to run again to seed a genuinely new environment without disturbing
// hand-edited config (e.g. a brand's `fromEmail` set via /admin/clients
// after the initial migration, per issue #196) on brands already migrated.
//
// Requires a real MONGODB_URI in .env.local — this sandbox has no network
// access to MongoDB Atlas (the same documented gap affecting every other
// Mongo-integration path in this repo), so this script could not be
// executed here. It has NOT been run against production; that is real,
// disclosed follow-up work for an environment with real DB access, not
// something claimed as already done.
//
// Usage:
//   npx tsx scripts/migrate-brands-to-mongo.ts            # dry run (default)
//   npx tsx scripts/migrate-brands-to-mongo.ts --apply    # writes changes

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import mongoose from 'mongoose';
import { FALLBACK_BRAND_CONFIG, type BrandConfig } from '../app/lib/brand';

const APPLY = process.argv.includes('--apply');
const BRANDS_COLLECTION = 'brands';
// Attribution for this one-time seed — a real super-admin user, not a
// per-request actor, since no admin session initiated it.
const MIGRATION_ACTOR = 'migration:migrate-brands-to-mongo';

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  console.log(APPLY ? 'Running in APPLY mode — this will write changes.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db!;
  const collection = db.collection(BRANDS_COLLECTION);

  if (APPLY) {
    await collection.createIndex({ slug: 1 }, { unique: true });
    await collection.createIndex({ aliases: 1 }, { unique: true });
    console.log('Ensured unique indexes on slug/aliases.\n');
  }

  const existingSlugs = new Set((await collection.find({}, { projection: { slug: 1 } }).toArray()).map((d: any) => d.slug));
  const now = new Date().toISOString();

  let seeded = 0;
  let skipped = 0;

  for (const [slug, config] of Object.entries(FALLBACK_BRAND_CONFIG) as [string, BrandConfig][]) {
    if (existingSlugs.has(slug)) {
      console.log(`SKIP  ${slug}: already present in ${BRANDS_COLLECTION}`);
      skipped++;
      continue;
    }

    const record = {
      slug,
      ...config,
      createdAt: now,
      createdBy: MIGRATION_ACTOR,
      updatedAt: now,
    };

    if (APPLY) {
      await collection.insertOne(record);
      console.log(`SEED  ${slug}: inserted (label=${config.label}, currency=${config.currency}, forecastModel=${config.forecastModel})`);
    } else {
      console.log(`DRY-RUN  ${slug}: would insert (label=${config.label}, currency=${config.currency}, forecastModel=${config.forecastModel})`);
    }
    seeded++;
  }

  console.log('\n=== Totals ===');
  console.log(`Brands seeded: ${seeded}`);
  console.log(`Brands already present (skipped): ${skipped}`);

  if (!APPLY && seeded > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
