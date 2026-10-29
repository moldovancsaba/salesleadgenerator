#!/usr/bin/env npx tsx
/**
 * Onboards 'Padel Africa' (`padel-africa`) into MongoDB collections:
 * 1. `brands`: Seeds brand definition with slug, label, aliases, ownNameTerms, salesVocabulary, fromEmail.
 * 2. `company_settings`: Upserts company sales settings for `padel-africa` (products, dealSize, regionMultipliers, seasonality, revenueTarget).
 * 3. `products`: Upserts first-class catalog products for Padel Africa.
 * 4. `sso_user_access`: Grants `admin` org access to `moldovancsaba@gmail.com` for `padel-africa`.
 *
 * Usage:
 *   npx tsx scripts/onboard-padel-africa.ts           # Dry-run
 *   npx tsx scripts/onboard-padel-africa.ts --apply   # Writes to DB
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { MongoClient } from 'mongodb';
import { FALLBACK_BRAND_CONFIG } from '../app/lib/brand-constants';

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'padel-africa';

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
  const padelBrandConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];
  if (!padelBrandConfig) {
    throw new Error(`Configuration for ${BRAND_SLUG} not found in FALLBACK_BRAND_CONFIG`);
  }

  console.log('\n--- 1. Brands Collection ---');
  const existingBrand = await brandsColl.findOne({ slug: BRAND_SLUG });
  const brandDoc = {
    slug: BRAND_SLUG,
    ...padelBrandConfig,
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

  // Also ensure cogmap, seyu, and dvsc exist in brands collection if empty
  const allBrandsCount = await brandsColl.countDocuments();
  if (allBrandsCount <= 1 && APPLY) {
    console.log('\nSeeding other fallback brands into empty `brands` collection...');
    for (const [slug, conf] of Object.entries(FALLBACK_BRAND_CONFIG)) {
      if (slug === BRAND_SLUG) continue;
      const doc = {
        slug,
        ...conf,
        createdAt: now,
        createdBy: 'migration:seed',
        updatedAt: now,
      };
      await brandsColl.updateOne({ slug }, { $set: doc }, { upsert: true });
      console.log(`[APPLIED] Seeded fallback brand "${slug}".`);
    }
  }

  // 2. Upsert in `company_settings`
  console.log('\n--- 2. Company Settings ---');
  const companySettingsColl = db.collection('company_settings');
  const existingSettings = await companySettingsColl.findOne({ brand: BRAND_SLUG });

  const companySettingsDoc = {
    brand: BRAND_SLUG,
    tenantId: 'default',
    companyName: 'Padel Africa',
    contactPerson: 'Csaba Moldovan',
    approver: 'Management',
    website: 'https://padel-africa.doneisbetter.com',
    mainIndustry: 'Sports & Padel Club Operations',
    customerTypes: [
      'sports_clubs',
      'academies',
      'event_organisers',
      'federations',
      'resorts_hotels',
      'indoor_arenas',
    ],
    customerTypesOther: '',
    dealSize: {
      small: 5000,       // Starter club listing / software subscription / small equipment bundle
      medium: 18000,     // Full venue management SaaS + tournament partnership
      large: 50000,      // Turnkey court installation & federation sponsorship
      enterprise: 150000,// Multi-venue franchise rollout & regional circuit sponsor
      largestWon: 60000,
    },
    exampleCustomer: {
      name: 'Virgin Active Padel Club / Premier Padel Cape Town',
      productsPurchased: 'Court booking SaaS & Pan-African Circuit Tournament Sponsorship',
      totalContractValue: 25000,
      contractLength: '1 year',
    },
    products: [
      {
        id: 'product-padel-saas',
        name: 'Padel Club Operations & Court Booking SaaS',
        description: 'Complete club management platform: online court bookings, WhatsApp player confirmations, automated payment processing, tournament draws, and multi-currency club finances across Africa.',
        whyTheyBuy: 'Automate club court utilization, prevent double bookings, and allow direct mobile bookings for players in ZAR, EGP, MAD, and EUR.',
        typicalBuyer: ['club', 'coach', 'club_owner', 'general_manager', 'court_operator'],
        typicalBuyerOther: 'Venue Operator',
        customerSize: ['small', 'medium', 'large'],
        pricingModels: ['monthly_subscription', 'annual_subscription'],
        pricing: {
          monthlyPrice: 150,
          annualPrice: 1500,
        },
        revenuePredictability: 'very_predictable',
      },
      {
        id: 'product-padel-buildout',
        name: 'Turnkey Padel Court Installation & Equipment Package',
        description: 'Design, delivery, panoramic glass court structural installation, silica sand turf flooring, LED lighting masts, and tournament-grade netting for new clubs and resorts.',
        whyTheyBuy: 'Fast, certified court supply and buildout tailored for African weather conditions and coastal climates.',
        typicalBuyer: ['club', 'club_owner', 'general_manager'],
        typicalBuyerOther: 'Property Developer / Resort GM',
        customerSize: ['medium', 'large', 'enterprise'],
        pricingModels: ['one_time', 'custom_quotation'],
        pricing: {
          oneTimePrice: 32000,
          customQuotationTypicalValue: 65000,
        },
        revenuePredictability: 'predictable',
      },
      {
        id: 'product-padel-sponsorship',
        name: 'African Padel Circuit Event & Media Sponsorship',
        description: 'Headline and court-side branding, live stream overlays, app banner placement, and activation booths across premier padel opens in South Africa, Egypt, Morocco, and Kenya.',
        whyTheyBuy: 'High-income demographic sports audience reaching affluent urban professionals and youth.',
        typicalBuyer: ['brand', 'commercial', 'marketing', 'tournament_director'],
        typicalBuyerOther: 'Sponsorship Director',
        customerSize: ['medium', 'large', 'enterprise'],
        pricingModels: ['campaign_based', 'per_event', 'framework_agreement'],
        pricing: {
          campaignPrice: 12000,
          perEventPrice: 5000,
          frameworkAnnualValue: 40000,
        },
        revenuePredictability: 'medium',
      },
      {
        id: 'product-padel-proshop',
        name: 'Pro Shop & Equipment Wholesale Supply',
        description: 'Wholesale racquets, pressurized balls, grips, bags, and club apparel direct from top global padel manufacturers for African pro shops.',
        whyTheyBuy: 'Reliable customs clearance, local stock availability, and healthy club resale margins.',
        typicalBuyer: ['club', 'coach', 'court_operator'],
        typicalBuyerOther: 'Pro Shop Manager',
        customerSize: ['small', 'medium'],
        pricingModels: ['one_time', 'framework_agreement'],
        pricing: {
          oneTimePrice: 2500,
          frameworkAnnualValue: 15000,
        },
        revenuePredictability: 'predictable',
      },
    ],
    purchaseFrequency: ['monthly', 'yearly', 'per_season', 'once'],
    purchaseFrequencyComments: 'SaaS is billed monthly/annually; court hardware is one-off; sponsorships are seasonal.',
    salesCycle: '1_3_months',
    seasonality: {
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      specificMonths: 'Year-round outdoor/indoor play; peak outdoor season Oct-April in Southern Africa, April-Oct in North Africa.',
    },
    upsell: {
      commonAdditionalProducts: 'Pro shop inventory, court maintenance contracts, regional tournament sponsorships.',
      typicalValue: 5000,
    },
    regionMultipliers: {
      ZA: 1.0,
      EG: 0.9,
      MA: 0.95,
      KE: 0.9,
      NG: 0.9,
      TN: 0.85,
      MU: 1.1,
      EU: 1.2,
      GLOBAL: 1.0,
    },
    revenueTarget: {
      amount: 450000,
      currency: 'EUR',
      period: 'annual',
    },
    inboxSettings: {
      includeAssignedLeadThreads: true,
      includeCcThreads: true,
    },
    notes: 'Padel Africa connects players, coaches, and clubs across 20+ African countries with directory discovery, court booking, hardware buildout, and competitive tournaments.',
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
      id: 'prod_padel_saas_monthly',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Padel Club Operations SaaS (Monthly)',
      description: 'Court reservation system, mobile payments, and member WhatsApp notifications.',
      unitPrice: 150,
      currency: 'EUR',
      pricingModel: 'monthly_subscription',
      active: true,
      sourceProductLineId: 'product-padel-saas',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_padel_saas_annual',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Padel Club Operations SaaS (Annual)',
      description: 'Annual license including member management, booking portal, and tournament draws.',
      unitPrice: 1500,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-padel-saas',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_padel_court_turnkey',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Panoramic Padel Court Supply & Installation',
      description: 'Complete panoramic padel court kit with tempered glass, turf, and LED floodlights.',
      unitPrice: 32000,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-padel-buildout',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_padel_circuit_sponsorship',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'African Circuit Tournament Sponsorship',
      description: 'Headline court branding and digital broadcast advertising during regional tour events.',
      unitPrice: 5000,
      currency: 'EUR',
      pricingModel: 'per_event',
      active: true,
      sourceProductLineId: 'product-padel-sponsorship',
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
