import { NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { requireCronOrApiKey } from '@/lib/api-auth';
import { FALLBACK_BRAND_CONFIG } from '@/app/lib/brand-constants';

export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'moldovancsaba@gmail.com';
const BRAND_SLUG = 'vegas';

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'MongoDB not configured' }, { status: 503 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const now = new Date().toISOString();

    // 1. Upsert Vegas in brands collection
    const brandsColl = db.collection('brands');
    const vegasConfig = FALLBACK_BRAND_CONFIG[BRAND_SLUG];
    if (vegasConfig) {
      await brandsColl.updateOne(
        { slug: BRAND_SLUG },
        {
          $set: {
            slug: BRAND_SLUG,
            ...vegasConfig,
            label: 'Vegas',
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
            createdBy: OWNER_EMAIL,
          },
        },
        { upsert: true }
      );
    }

    // 2. Company Settings for Vegas
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
        small: 500,
        medium: 2500,
        large: 12000,
        enterprise: 50000,
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

    await companySettingsColl.updateOne(
      { brand: BRAND_SLUG },
      { $set: companySettingsDoc },
      { upsert: true }
    );

    // 3. Catalog Products
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
      await productsColl.updateOne(
        { id: item.id },
        { $set: item },
        { upsert: true }
      );
    }

    // 4. Grant Admin SSO Access for moldovancsaba@gmail.com
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
          updatedAt: now,
        },
      }
    );

    const brands = await brandsColl.find({}).toArray();
    const users = await ssoColl.find({}).toArray();

    return NextResponse.json({
      success: true,
      brands: brands.map((b) => ({ slug: b.slug, label: b.label })),
      userAccess: users.map((u) => ({ email: u.email, orgAccess: u.orgAccess })),
    });
  } catch (err: any) {
    console.error('[API:admin/onboard-vegas] error:', err);
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
