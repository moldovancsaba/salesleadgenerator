import { NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { requireApiKey } from '@/lib/api-auth';
import { FALLBACK_BRAND_CONFIG } from '@/app/lib/brand-constants';

export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'racket-land';
const LEGACY_SLUG = 'padel-africa';

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'MongoDB not configured' }, { status: 503 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const now = new Date().toISOString();

    const results: Record<string, unknown> = {};

    // 1. Brands collection
    const brandsColl = db.collection('brands');
    const racketConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];
    const padelConfig = FALLBACK_BRAND_CONFIG[LEGACY_SLUG];

    if (racketConfig) {
      await brandsColl.updateOne(
        { slug: BRAND_SLUG },
        {
          $set: {
            slug: BRAND_SLUG,
            ...racketConfig,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now, createdBy: OWNER_EMAIL },
        },
        { upsert: true }
      );
    }

    if (padelConfig) {
      await brandsColl.updateOne(
        { slug: LEGACY_SLUG },
        {
          $set: {
            slug: LEGACY_SLUG,
            ...padelConfig,
            label: 'Racket.land',
            updatedAt: now,
          },
        }
      );
    }
    results.brands = 'Updated racket-land and padel-africa in brands collection';

    // 2. Company Settings
    const companySettingsColl = db.collection('company_settings');
    const existingPadelSettings = await companySettingsColl.findOne({ brand: LEGACY_SLUG });

    const digitalOfferings = [
      {
        id: 'product-racket-directory-listing',
        name: 'Directory Listing Showcase & Priority Placement',
        description: 'Verified venue profile on racket.land with interactive map, court specs, photo gallery, and direct booking links.',
        ticketSizeEstimate: 1200,
        dealStageSpeed: 'fast',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-racket-saas-booking',
        name: 'Court Booking & Venue Operations SaaS',
        description: 'Online court reservation software, mobile payments, WhatsApp reminders, and multi-sport schedule management for clubs.',
        ticketSizeEstimate: 3600,
        dealStageSpeed: 'medium',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-racket-tournament-platform',
        name: 'Tournament & League Management Platform',
        description: 'Automated draw brackets, player registrations, real-time match scoring, and circuit rankings for events and organizers.',
        ticketSizeEstimate: 8000,
        dealStageSpeed: 'medium',
        icpFit: 'high',
        salesMaterialsAvailable: true,
      },
      {
        id: 'product-racket-federation-infrastructure',
        name: 'Federation Digital Rating & Member Portal',
        description: 'National/regional federation player ratings, digital membership cards, sanctioned club network, and tournament approval.',
        ticketSizeEstimate: 25000,
        dealStageSpeed: 'slow',
        icpFit: 'medium',
        salesMaterialsAvailable: true,
      },
    ];

    const companySettingsDoc = {
      brand: BRAND_SLUG,
      tenantId: 'default',
      companyName: 'Racket.land',
      contactPerson: 'Csaba Moldovan',
      approver: 'Management',
      website: 'https://racket.land',
      mainIndustry: 'Racket Sports Digital Infrastructure & Directory Services',
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
      customerTypesOther: '',
      dealSize: {
        small: 1200,
        medium: 3600,
        large: 8000,
        enterprise: 25000,
        largestWon: 35000,
      },
      exampleCustomer: {
        name: 'Metropolitan Racket Club / National Padel & Tennis Center',
        productsPurchased: 'Court Booking SaaS + Directory Listing Showcase + Annual Tournament Engine',
        totalContractValue: 12800,
        contractLength: '12 months',
      },
      products: digitalOfferings,
      competitors: [
        {
          name: 'Generic Sports Facility Software',
          ourAdvantage: 'Dedicated racket-sport workflows (court splits, player ratings, tournament draws, multi-racket directory discoverability).',
        },
        {
          name: 'Manual Booking / WhatsApp Spreadsheets',
          ourAdvantage: 'Automated digital reservations, instant payments, automated reminder pacing, and public listing traffic.',
        },
      ],
      seasonality: {
        peakQuarters: ['Q1', 'Q2', 'Q3', 'Q4'],
        specificMonths: 'Year-round indoor & outdoor tennis, padel, pickleball, and squash operations.',
      },
      upsell: {
        commonAdditionalProducts: 'Tournament draw add-ons, premium featured directory placement, federation sanctioned ratings.',
        typicalValue: 2500,
      },
      regionMultipliers: existingPadelSettings?.regionMultipliers || {
        GLOBAL: 1.0,
        EU: 1.0,
        US: 1.2,
        ZA: 0.9,
      },
      revenueTarget: {
        amount: 350000,
        currency: 'EUR',
        period: 'annual',
      },
      inboxSettings: {
        includeAssignedLeadThreads: true,
        includeCcThreads: true,
      },
      notes: 'Racket.land (https://racket.land) is a pure digital services platform providing directory listings, SaaS court booking, tournament management, and federation tools across tennis, padel, pickleball, and all racket sports.',
      updatedAt: now,
    };

    await companySettingsColl.updateOne(
      { brand: BRAND_SLUG },
      { $set: companySettingsDoc },
      { upsert: true }
    );
    // Also update legacy padel-africa company_settings to reflect Racket.land rebranding
    await companySettingsColl.updateOne(
      { brand: LEGACY_SLUG },
      {
        $set: {
          companyName: 'Racket.land',
          website: 'https://racket.land',
          mainIndustry: 'Racket Sports Digital Infrastructure & Directory Services',
          notes: 'Racket.land (https://racket.land) - rebranded from Padel Africa. Pure digital services.',
          products: digitalOfferings,
          updatedAt: now,
        },
      }
    );
    results.company_settings = 'Updated company settings for racket-land and padel-africa';

    // 3. SSO User Access
    const ssoColl = db.collection('sso_user_access');
    await ssoColl.updateMany(
      {
        $or: [
          { email: OWNER_EMAIL },
          { aliases: OWNER_EMAIL },
        ],
      },
      {
        $set: {
          [`orgAccess.${BRAND_SLUG}`]: 'admin',
          [`orgAccess.${LEGACY_SLUG}`]: 'admin',
          updatedAt: now,
        },
      }
    );
    results.sso_user_access = 'Granted admin access to owner for racket-land and padel-africa';

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('[API:admin/rebrand-racket-land] error:', err);
    return NextResponse.json({ error: err?.message || 'Rebrand migration failed' }, { status: 500 });
  }
}
