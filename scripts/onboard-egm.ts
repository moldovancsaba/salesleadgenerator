#!/usr/bin/env npx tsx
/**
 * Onboards 'EGM' (`egm`) into MongoDB collections:
 * 1. `brands`: Seeds brand definition with slug, label, aliases, ownNameTerms, salesVocabulary, fromEmail.
 * 2. `company_settings`: Upserts company sales settings for `egm` (products, dealSize, regionMultipliers, seasonality, revenueTarget).
 * 3. `products`: Upserts first-class catalog products for EGM.
 * 4. `sso_user_access`: Grants `admin` org access to `moldovancsaba@gmail.com` for `egm`.
 *
 * Usage:
 *   npx tsx scripts/onboard-egm.ts           # Dry-run
 *   npx tsx scripts/onboard-egm.ts --apply   # Writes to DB
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { MongoClient } from 'mongodb';
import { FALLBACK_BRAND_CONFIG } from '../app/lib/brand-constants';

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'egm';

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
  const egmBrandConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];
  if (!egmBrandConfig) {
    throw new Error(`Configuration for ${BRAND_SLUG} not found in FALLBACK_BRAND_CONFIG`);
  }

  console.log('\n--- 1. Brands Collection ---');
  const existingBrand = await brandsColl.findOne({ slug: BRAND_SLUG });
  const brandDoc = {
    slug: BRAND_SLUG,
    ...egmBrandConfig,
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
    companyName: 'EGM Studio',
    contactPerson: 'Csaba Moldovan',
    approver: 'Management',
    website: 'https://egm-xi.vercel.app',
    mainIndustry: 'Interactive Media & Creative Production',
    customerTypes: [
      'brands',
      'agencies',
      'event_organisers',
      'corporations',
      'studios',
    ],
    customerTypesOther: '',
    dealSize: {
      small: 8000,       // Creative concept / interactive prototype
      medium: 25000,     // Production package / interactive installation
      large: 65000,      // Enterprise campaign / global brand activation
      enterprise: 150000,// Multi-market seasonal experience & custom engineering
      largestWon: 85000,
    },
    exampleCustomer: {
      name: 'Global Experiential Brand / Agency Partner',
      productsPurchased: 'Interactive Experience Studio Production & Turnkey Activation',
      totalContractValue: 45000,
      contractLength: '6 months',
    },
    products: [
      {
        id: 'product-egm-creative-production',
        name: 'Interactive Studio Creative Production',
        description: 'End-to-end interactive media production, spatial installations, and digital brand experiences.',
        ticketSizeEstimate: 25000,
        dealStageSpeed: 'medium',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-egm-tech-prototype',
        name: 'Experiential Tech Prototype & MVP',
        description: 'Rapid prototyping for interactive digital-physical activations and brand experiences.',
        ticketSizeEstimate: 12000,
        dealStageSpeed: 'fast',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-egm-enterprise-retainer',
        name: 'Enterprise Studio Production Retainer',
        description: 'Ongoing dedicated studio capacity for recurring brand activations and digital campaigns.',
        ticketSizeEstimate: 75000,
        dealStageSpeed: 'slow',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
    ],
    competitors: [
      {
        name: 'Traditional Creative Agencies',
        ourAdvantage: 'High-speed technical execution, real-time interactivity, and agile studio delivery.',
      },
      {
        name: 'Boutique Production Houses',
        ourAdvantage: 'Full-stack software engineering integration with hardware and event infrastructure.',
      },
    ],
    seasonality: {
      peakQuarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      specificMonths: 'Year-round commercial brand campaigns and seasonal product launches.',
    },
    upsell: {
      commonAdditionalProducts: 'Multi-city event rollouts, technical support retainers, custom hardware rigs.',
      typicalValue: 15000,
    },
    regionMultipliers: {
      HU: 0.8,
      EU: 1.0,
      UK: 1.2,
      US: 1.3,
      GLOBAL: 1.0,
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
    notes: 'EGM delivers interactive media, creative technology prototypes, and experiential brand production.',
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
      id: 'prod_egm_prototype',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Interactive Tech Prototype & MVP',
      description: 'Rapid physical-digital prototype for client pitches and experience testing.',
      unitPrice: 12000,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-egm-tech-prototype',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_egm_production_package',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Full Interactive Experience Production',
      description: 'Turnkey creative technology installation including software, interaction design, and staging.',
      unitPrice: 35000,
      currency: 'EUR',
      pricingModel: 'one_time',
      active: true,
      sourceProductLineId: 'product-egm-creative-production',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prod_egm_annual_retainer',
      brand: BRAND_SLUG,
      tenantId: 'default',
      name: 'Studio Production Retainer (Annual)',
      description: 'Dedicated studio production capacity and priority creative engineering.',
      unitPrice: 75000,
      currency: 'EUR',
      pricingModel: 'annual_subscription',
      active: true,
      sourceProductLineId: 'product-egm-enterprise-retainer',
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
