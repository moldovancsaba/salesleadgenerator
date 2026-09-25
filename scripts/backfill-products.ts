#!/usr/bin/env npx tsx
// Backfill for issue #215: promotes each brand's Sales Settings
// ProductLine[] into the new `products` catalog collection. Imports the
// real algorithm from lib/backfill-products.ts directly — same pattern
// scripts/backfill-ticket-size.ts already established.
//
// Requires a real MONGODB_URI in .env.local — this sandbox has no network
// access to MongoDB Atlas (confirmed blocked, the same documented gap
// affecting every other Mongo-integration path in this repo), so this
// script could not be executed here. It has NOT been run against
// production; that is real, disclosed follow-up work, not something
// claimed as already done. The repo owner has no terminal/CLI access
// (mobile-only, per CLAUDE.md) — see the x-api-key-guarded
// POST /api/admin/products-backfill route for the path they can actually
// trigger.
//
// Usage:
//   npx tsx scripts/backfill-products.ts                     # dry run (default), all brands
//   npx tsx scripts/backfill-products.ts --apply              # writes changes
//   npx tsx scripts/backfill-products.ts --brand=cogmap        # a single brand only
//
// Idempotent: safe to re-run. A ProductLine whose derived catalog rows
// already match, or a row an admin has manually edited since the initial
// backfill, is skipped (reported "unchanged").

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import mongoose from 'mongoose';
import { backfillProductsForBrand } from '../lib/backfill-products';
import { defaultRevenueTargetCurrency } from '../app/lib/sales-settings';
import { getAllBrandConfigs } from '../app/lib/brand';

const APPLY = process.argv.includes('--apply');
const brandArg = process.argv.find((a) => a.startsWith('--brand='));
const TENANT_ID = 'default';

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  const ALL_BRANDS: Array<{ brand: string; currency: ReturnType<typeof defaultRevenueTargetCurrency> }> = Object.entries(await getAllBrandConfigs())
    .map(([brand, config]) => ({ brand, currency: config.currency }));

  const BRANDS = brandArg
    ? ALL_BRANDS.filter((b) => b.brand === brandArg.split('=')[1])
    : ALL_BRANDS;

  console.log(APPLY ? 'Running in APPLY mode — this will write changes.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const totals = { scanned: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 };

  for (const { brand, currency: brandCurrency } of BRANDS) {
    console.log(`--- ${brand} ---`);
    const settingsDoc = await db!.collection('company_settings').findOne({ brand, tenantId: TENANT_ID });
    const currency = (settingsDoc as any)?.revenueTarget?.currency ?? defaultRevenueTargetCurrency(brandCurrency);
    const result = await backfillProductsForBrand(db, brand, TENANT_ID, currency, { apply: APPLY });
    for (const d of result.docs) {
      if (d.outcome !== 'unchanged') {
        console.log(`${APPLY ? 'WRITE' : 'DRY-RUN'} products/${d.id}: ${d.outcome}`);
      }
    }
    console.log(`${brand}: scanned=${result.scanned} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped}\n`);
    totals.scanned += result.scanned;
    totals.created += result.created;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    totals.skipped += result.skipped;
  }

  console.log('=== Totals ===');
  console.log(`Product lines scanned: ${totals.scanned}`);
  console.log(`Catalog rows created: ${totals.created}`);
  console.log(`Catalog rows updated: ${totals.updated}`);
  console.log(`Catalog rows unchanged: ${totals.unchanged}`);
  console.log(`Catalog rows skipped (unnamed/unpriced): ${totals.skipped}`);

  if (!APPLY && totals.scanned > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
