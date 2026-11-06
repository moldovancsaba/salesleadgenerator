#!/usr/bin/env npx tsx
/**
 * Rebrands 'Padel Africa' (`padel-africa`) to 'Racket.land' (`racket-land`):
 * 1. `brands`: Updates or inserts `racket-land` and `padel-africa` with Racket.land configuration.
 * 2. `company_settings`: Updates company sales settings to Racket.land digital service offerings.
 * 3. `products`: Upserts pure digital service catalog items for Racket.land.
 * 4. `sso_user_access`: Grants `admin` access for both `racket-land` and `padel-africa` to `moldovancsaba@gmail.com`.
 *
 * Usage:
 *   npx tsx scripts/rebrand-racket-land.ts           # Dry-run
 *   npx tsx scripts/rebrand-racket-land.ts --apply   # Writes to DB
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { MongoClient } from 'mongodb';
import { FALLBACK_BRAND_CONFIG } from '../app/lib/brand-constants';

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'racket-land';
const LEGACY_SLUG = 'padel-africa';

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in environment or .env.local');
    process.exit(1);
  }

  console.log(APPLY ? 'Running in APPLY mode — writing changes to database.' : 'Running in DRY-RUN mode — pass --apply to execute writes.');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const now = new Date().toISOString();

  // 1. Brands Collection
  console.log('\n--- 1. Brands Collection ---');
  const brandsColl = db.collection('brands');
  const racketConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];

  const brandDoc = {
    slug: BRAND_SLUG,
    ...racketConfig,
    updatedAt: now,
  };

  if (APPLY) {
    await brandsColl.updateOne(
      { slug: BRAND_SLUG },
      { $set: brandDoc, $setOnInsert: { createdAt: now, createdBy: OWNER_EMAIL } },
      { upsert: true }
    );
    // Also update legacy padel-africa document in brands to point to Racket.land label
    await brandsColl.updateOne(
      { slug: LEGACY_SLUG },
      { $set: { ...FALLBACK_BRAND_CONFIG[LEGACY_SLUG], label: 'Racket.land', updatedAt: now } }
    );
    console.log(`[APPLIED] Upserted brand "${BRAND_SLUG}" and updated "${LEGACY_SLUG}" in 'brands'.`);
  } else {
    console.log(`[DRY RUN] Would upsert brand "${BRAND_SLUG}" with:`, JSON.stringify(brandDoc, null, 2));
  }

  // 2. Company Settings
  console.log('\n--- 2. Company Settings ---');
  const companySettingsColl = db.collection('company_settings');

  const companySettingsDoc = {
    brand: BRAND_SLUG,
    tenantId: 'default',
    companyName: 'Racket.land',
    contactPerson: 'Csaba Moldovan',
    approver: 'Management',
    website: 'https://racket.land',
    mainIndustry: 'Racket Sports Digital Services & Venue Directory',
    customerTypes: [
      'sports_clubs',
      'racket_venues',
      'tennis_clubs',
      'padel_clubs',
      'pickleball_centers',
      'academies',
      'event_organisers',
      'federations',
      'resorts_hotels',
      'indoor_arenas',
      'municipal_complexes',
    ],
    customerTypesOther: 'Multi-racket clubs, tournament organizers, national federations',
    dealSize: {
      small: 1800,       // Annual Premium Venue Directory Listing Showcase
      medium: 6000,      // Online Court Booking & Venue Operations SaaS
      large: 18000,      // Tournament, League & Rating Software Suite
      enterprise: 45000, // Federation National Digital Platform & Member Rating System
      largestWon: 25000,
    },
    exampleCustomer: {
      name: 'Premier Racket Club / National Padel & Pickleball Federation',
      productsPurchased: 'Online Court Booking SaaS + Tournament & Player Rating Platform',
      totalContractValue: 18000,
      contractLength: '1 year',
    },
    products: [
      {
        id: 'product-racket-directory',
        name: 'Venue Directory Listing & Digital Showcase',
        description: 'Verified public venue listing on Racket.land (https://racket.land), premium ranking, direct booking links, and player reviews.',
        pricingModel: 'annual_subscription',
        unitPrice: 1800,
        currency: 'EUR',
        active: true,
      },
      {
        id: 'product-racket-saas',
        name: 'Racket Venue Operations & Online Court Booking SaaS',
        description: 'Complete digital court reservation system: mobile booking, online payments, member tiers, and off-peak occupancy optimization for tennis, padel, and pickleball.',
        pricingModel: 'monthly_subscription',
        unitPrice: 500,
        currency: 'EUR',
        active: true,
      },
      {
        id: 'product-racket-tournaments',
        name: 'Tournament, Ladder & League Management Software',
        description: 'Digital tournament bracket generator, automated scheduling, live match score reporting, and member ladder management.',
        pricingModel: 'annual_subscription',
        unitPrice: 3500,
        currency: 'EUR',
        active: true,
      },
      {
        id: 'product-racket-federation',
        name: 'Federation Digital Member & Rating Infrastructure',
        description: 'National and regional federation management portal, player ranking/handicap algorithms, club affiliation registry, and sanctioned event accreditation.',
        pricingModel: 'annual_subscription',
        unitPrice: 15000,
        currency: 'EUR',
        active: true,
      },
    ],
    seasonality: {
      peakQuarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      specificMonths: 'Year-round indoor/outdoor racket sports play across global markets.',
    },
    upsell: {
      commonAdditionalProducts: 'White-label mobile booking app, branded tournament live-scoring widgets, multi-location enterprise sync.',
      typicalValue: 3500,
    },
    regionMultipliers: {
      GLOBAL: 1.0,
      EU: 1.2,
      US: 1.3,
      UK: 1.25,
      ZA: 1.0,
      EG: 0.9,
      MA: 0.95,
      ME: 1.2,
      ASIA: 1.1,
    },
    revenueTarget: {
      amount: 500000,
      currency: 'EUR',
      period: 'annual',
    },
    inboxSettings: {
      includeAssignedLeadThreads: true,
      includeCcThreads: true,
    },
    notes: 'Racket.land (https://racket.land) is the global directory and digital platform providing pure digital services to venues, clubs, and federations across tennis, padel, pickleball, squash, and badminton.',
    updatedAt: now,
  };

  if (APPLY) {
    // Update both racket-land and padel-africa company_settings
    await companySettingsColl.updateOne(
      { brand: BRAND_SLUG },
      { $set: companySettingsDoc },
      { upsert: true }
    );
    await companySettingsColl.updateOne(
      { brand: LEGACY_SLUG },
      { $set: { ...companySettingsDoc, brand: LEGACY_SLUG } },
      { upsert: true }
    );
    console.log(`[APPLIED] Upserted company_settings for "${BRAND_SLUG}" and "${LEGACY_SLUG}".`);
  } else {
    console.log(`[DRY RUN] Would upsert company_settings for "${BRAND_SLUG}".`);
  }

  // 3. Catalog Products
  console.log('\n--- 3. Catalog Products Collection ---');
  const productsColl = db.collection('products');
  const digitalProducts = [
    {
      id: 'prod_racket_directory_annual',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Racket.land Venue Directory Showcase (Annual)',
      description: 'Verified public venue listing on Racket.land directory with priority ranking and direct booking redirects.',
      unitPrice: 1800,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-racket-directory',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_racket_saas_monthly',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Racket Venue Operations & Court Booking SaaS (Monthly)',
      description: 'Online court reservation software, mobile checkout, and member notifications for tennis, padel, and pickleball.',
      unitPrice: 500,
      currency: 'EUR',
      pricingModel: 'monthly_subscription',
      active: true,
      sourceProductLineId: 'product-racket-saas',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_racket_saas_annual',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Racket Venue Operations & Court Booking SaaS (Annual)',
      description: 'Annual license including automated court reservations, membership portal, and calendar sync.',
      unitPrice: 5400,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-racket-saas',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_racket_tournaments_annual',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Tournament & League Management Platform (Annual)',
      description: 'Digital draws, automated match scheduling, live scoreboards, and ladder ranking system.',
      unitPrice: 3500,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-racket-tournaments',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_racket_federation_infrastructure',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Federation Member & Rating Infrastructure',
      description: 'Digital governance portal, sanctioned player ratings, and club tournament accreditation suite.',
      unitPrice: 15000,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-racket-federation',
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const item of digitalProducts) {
    if (APPLY) {
      await productsColl.updateOne(
        { id: item.id },
        { $set: item },
        { upsert: true }
      );
      // Also upsert with padel-africa brand for seamless legacy access
      const legacyItem = { ...item, id: item.id.replace('racket', 'padel'), brand: LEGACY_SLUG };
      await productsColl.updateOne(
        { id: legacyItem.id },
        { $set: legacyItem },
        { upsert: true }
      );
      console.log(`[APPLIED] Upserted catalog product "${item.name}".`);
    } else {
      console.log(`[DRY RUN] Would upsert product "${item.id}" (${item.name}).`);
    }
  }

  // 4. SSO User Access
  console.log('\n--- 4. SSO User Access ---');
  const ssoColl = db.collection('sso_user_access');
  const ownerRecords = await ssoColl.find({
    $or: [{ email: OWNER_EMAIL }, { aliases: OWNER_EMAIL }],
  }).toArray();

  for (const rec of ownerRecords) {
    if (APPLY) {
      await ssoColl.updateOne(
        { _id: rec._id },
        {
          $set: {
            [`orgAccess.${BRAND_SLUG}`]: 'admin',
            [`orgAccess.${LEGACY_SLUG}`]: 'admin',
            updatedAt: now,
          },
        }
      );
      console.log(`[APPLIED] Granted "${BRAND_SLUG}" and "${LEGACY_SLUG}": "admin" on user ${rec.email}.`);
    } else {
      console.log(`[DRY RUN] Would set orgAccess.${BRAND_SLUG} = 'admin' on user ${rec.email}.`);
    }
  }

  await client.close();
  console.log('\nRebranding migration completed.');
}

main().catch((err) => {
  console.error('Fatal error during rebranding:', err);
  process.exit(1);
});
