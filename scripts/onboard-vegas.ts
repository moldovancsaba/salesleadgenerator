#!/usr/bin/env npx tsx
/**
 * Onboards 'Vegas' (`vegas` / Mr Vegas) into MongoDB collections:
 * 1. `brands`: Seeds brand definition with slug, label, aliases, ownNameTerms, salesVocabulary, fromEmail.
 * 2. `company_settings`: Upserts company sales settings for `vegas` (products, dealSize, regionMultipliers, seasonality, revenueTarget).
 * 3. `products`: Upserts first-class catalog products for Vegas.
 * 4. `sso_user_access`: Grants `admin` org access to `moldovancsaba@gmail.com` for `vegas`.
 *
 * Usage:
 *   npx tsx scripts/onboard-vegas.ts           # Dry-run
 *   npx tsx scripts/onboard-vegas.ts --apply   # Writes to DB
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { MongoClient } from 'mongodb';
import { FALLBACK_BRAND_CONFIG } from '../app/lib/brand-constants';

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'vegas';

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

  // 1. Upsert in `brands` collection
  const brandsColl = db.collection('brands');
  const vegasBrandConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];
  if (!vegasBrandConfig) {
    throw new Error(`Configuration for ${BRAND_SLUG} not found in FALLBACK_BRAND_CONFIG`);
  }

  console.log('\n--- 1. Brands Collection ---');
  const existingBrand = await brandsColl.findOne({ slug: BRAND_SLUG });
  const brandDoc = {
    slug: BRAND_SLUG,
    ...vegasBrandConfig,
    createdAt: existingBrand?.createdAt || now,
    createdBy: existingBrand?.createdBy || OWNER_EMAIL,
    updatedAt: now,
  };

  if (APPLY) {
    await brandsColl.createIndex({ slug: 1 }, { unique: true });
    await brandsColl.createIndex({ aliases: 1 }, { unique: true });
    await brandsColl.updateOne(
      { slug: BRAND_SLUG },
      { $set: brandDoc },
      { upsert: true }
    );
    console.log(`[APPLIED] Upserted brand "${BRAND_SLUG}" in 'brands' collection.`);
  } else {
    console.log(`[DRY RUN] Would upsert brand "${BRAND_SLUG}" with:`, JSON.stringify(brandDoc, null, 2));
  }

  // 2. Upsert in `company_settings`
  console.log('\n--- 2. Company Settings ---');
  const companySettingsColl = db.collection('company_settings');

  const companySettingsDoc = {
    brand: BRAND_SLUG,
    tenantId: 'default',
    companyName: 'Mr Vegas (Grand Slam of Darts Partner)',
    contactPerson: 'Csaba Moldovan',
    approver: 'Management',
    website: 'https://www.mrvegas.com',
    mainIndustry: 'Sports Sponsorship & Tournament Lead Acquisition',
    customerTypes: [
      'sports_fans',
      'event_attendees',
      'tournament_guests',
      'hospitality_vip',
      'sponsorship_partners',
      'darts_enthusiasts',
      'corporate_hospitality',
    ],
    customerTypesOther: '',
    dealSize: {
      small: 500,        // General Admission & standard ticket giveaways / entry tier
      medium: 2500,      // VIP Hospitality & Table Packages
      large: 12000,      // Corporate hospitality box & tournament partnership
      enterprise: 50000, // Co-branded title sponsorship & broadcast integration
      largestWon: 35000,
    },
    exampleCustomer: {
      name: 'PDC Major Tournament Attendee / Corporate Hospitality Guest',
      productsPurchased: 'VIP Grand Slam Hospitality & Corporate Sponsorship Package',
      totalContractValue: 7500,
      contractLength: 'Tournament week',
    },
    products: [
      {
        id: 'product-vegas-ga-tickets',
        name: 'Grand Slam of Darts Ticket Giveaway & Fan Acquisition',
        description: 'Free-to-enter tournament ticket giveaway campaign to acquire qualified darts fans and casino player accounts.',
        ticketSizeEstimate: 500,
        dealStageSpeed: 'fast',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-vegas-vip-hospitality',
        name: 'VIP Darts Hospitality & Table Experiences',
        description: 'Premium hospitality tables, meet-and-greets with darts legends, and VIP dining at Aldersley.',
        ticketSizeEstimate: 2500,
        dealStageSpeed: 'medium',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-vegas-corporate-activation',
        name: 'Corporate Brand Sponsorship & Walk-On Stage Activation',
        description: 'B2B brand activations, walk-on stage branding, and corporate entertaining packages during tournament week.',
        ticketSizeEstimate: 15000,
        dealStageSpeed: 'medium',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
    ],
    competitors: [
      {
        name: 'Direct Sports Betting & Casino Sponsors',
        ourAdvantage: 'High-energy live tournament presence, generous player promotions, and premier VIP hospitality.',
      },
    ],
    seasonality: {
      peakQuarters: ['Q4'],
      specificMonths: 'Peak in November during the Grand Slam of Darts at Aldersley.',
    },
    upsell: {
      commonAdditionalProducts: 'VIP hospitality upgrades, additional guest tickets, hospitality table bookings.',
      typicalValue: 1200,
    },
    regionMultipliers: {
      UK: 1.3,
      EU: 1.0,
      GLOBAL: 1.0,
    },
    revenueTarget: {
      amount: 250000,
      currency: 'EUR',
      period: 'annual',
    },
    inboxSettings: {
      includeAssignedLeadThreads: true,
      includeCcThreads: true,
    },
    notes: 'Mr Vegas is the official title sponsor of the Grand Slam of Darts at WV Active Aldersley.',
    updatedAt: now,
  };

  if (APPLY) {
    await companySettingsColl.updateOne(
      { brand: BRAND_SLUG },
      { $set: companySettingsDoc },
      { upsert: true }
    );
    console.log(`[APPLIED] Upserted company_settings for "${BRAND_SLUG}".`);
  } else {
    console.log(`[DRY RUN] Would upsert company_settings for "${BRAND_SLUG}".`);
  }

  // 3. Upsert Catalog Products in `products` collection
  console.log('\n--- 3. Catalog Products Collection ---');
  const productsColl = db.collection('products');
  const catalogItems = [
    {
      id: 'prod_vegas_fan_giveaway',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Grand Slam Ticket Giveaway & Fan Acquisition',
      description: 'Tournament ticket sweepstakes and marketing campaign lead ingestion.',
      unitPrice: 500,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-vegas-ga-tickets',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_vegas_vip_hospitality',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'VIP Darts Hospitality Package',
      description: 'Exclusive hospitality seats, catering, and legendary player reception.',
      unitPrice: 2500,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-vegas-vip-hospitality',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_vegas_corporate_package',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Corporate Hospitality & Sponsor Activation',
      description: 'B2B brand entertaining and tournament sponsorship presence.',
      unitPrice: 15000,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-vegas-corporate-activation',
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const item of catalogItems) {
    if (APPLY) {
      await productsColl.updateOne(
        { id: item.id },
        { $set: item },
        { upsert: true }
      );
      console.log(`[APPLIED] Upserted catalog product "${item.name}".`);
    } else {
      console.log(`[DRY RUN] Would upsert product "${item.id}" (${item.name}).`);
    }
  }

  // 4. Grant Admin SSO Access for moldovancsaba@gmail.com
  console.log('\n--- 4. SSO User Access ---');
  const ssoColl = db.collection('sso_user_access');
  const ownerRecords = await ssoColl.find({
    $or: [
      { email: OWNER_EMAIL },
      { aliases: OWNER_EMAIL },
    ],
  }).toArray();

  if (ownerRecords.length === 0) {
    console.warn(`WARNING: No sso_user_access record found for ${OWNER_EMAIL}.`);
  } else {
    for (const rec of ownerRecords) {
      console.log(`Found user access record for: ${rec.email} (ID: ${rec.ssoUserId})`);
      if (APPLY) {
        await ssoColl.updateOne(
          { _id: rec._id },
          {
            $set: {
              [`orgAccess.${BRAND_SLUG}`]: 'admin',
              updatedAt: now,
            },
          }
        );
        console.log(`[APPLIED] Granted "${BRAND_SLUG}": "admin" on user ${rec.email}.`);
      } else {
        console.log(`[DRY RUN] Would set orgAccess.${BRAND_SLUG} = 'admin' on user ${rec.email}.`);
      }
    }
  }

  await client.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error during onboarding:', err);
  process.exit(1);
});
