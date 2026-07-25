#!/usr/bin/env npx tsx
// Backfill for issue #81: computes and writes ticketSizeEstimate (issue #79)
// for every existing lead written before that shipped. Imports the real
// algorithm from lib/backfill-ticket-size.ts directly — same pattern
// scripts/backfill-title-normalization.ts already established.
//
// Requires a real MONGODB_URI in .env.local — this sandbox has no network
// access to MongoDB Atlas (confirmed blocked, the same documented gap
// affecting every other Mongo-integration path in this repo), so this
// script could not be executed here. It has NOT been run against
// production; that is real, disclosed follow-up work, not something
// claimed as already done. The repo owner has no terminal/CLI access
// (mobile-only, per CLAUDE.md) — see the x-api-key-guarded
// POST /api/admin/ticket-size-backfill route for the path they can
// actually trigger.
//
// Usage:
//   npx tsx scripts/backfill-ticket-size.ts                     # dry run (default), both brands
//   npx tsx scripts/backfill-ticket-size.ts --apply              # writes changes
//   npx tsx scripts/backfill-ticket-size.ts --brand=cogmap        # a single brand only
//
// Idempotent: safe to re-run. A lead whose stored ticketSizeEstimate
// already matches what estimateTicketSize() would derive today is skipped.

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import mongoose from 'mongoose';
import { backfillTicketSizeCollection } from '../lib/backfill-ticket-size';
import { defaultRevenueTargetCurrency } from '../app/lib/sales-settings';

const APPLY = process.argv.includes('--apply');
const brandArg = process.argv.find((a) => a.startsWith('--brand='));
const TENANT_ID = 'default';

const ALL_BRANDS: Array<{ brand: string; collection: string }> = [
  { brand: 'cogmap', collection: 'leads' },
  { brand: 'seyu', collection: 'seyu_leads' },
];

const BRANDS = brandArg
  ? ALL_BRANDS.filter((b) => b.brand === brandArg.split('=')[1])
  : ALL_BRANDS;

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
  const totals = { scanned: 0, updated: 0, unchanged: 0 };

  for (const { brand, collection } of BRANDS) {
    console.log(`--- ${brand} (${collection}) ---`);
    const currency = defaultRevenueTargetCurrency(brand);
    const result = await backfillTicketSizeCollection(db, collection, brand, TENANT_ID, currency, { apply: APPLY });
    for (const d of result.docs) {
      if (d.outcome === 'updated') {
        console.log(`${APPLY ? 'UPDATE' : 'DRY-RUN'} ${collection}/${d.id}: ${d.outcome} (method=${d.method})`);
      }
    }
    console.log(`${collection}: scanned=${result.scanned} updated=${result.updated} unchanged=${result.unchanged}`);
    console.log(`  method breakdown: ${JSON.stringify(result.methodCounts)}\n`);
    totals.scanned += result.scanned;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
  }

  console.log('=== Totals ===');
  console.log(`Documents scanned: ${totals.scanned}`);
  console.log(`Documents updated: ${totals.updated}`);
  console.log(`Documents unchanged: ${totals.unchanged}`);

  if (!APPLY && totals.scanned > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
