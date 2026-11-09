import { NextRequest, NextResponse } from 'next/server';
import { isAppleWalletConfigured, createAppleWalletPass, PassThemingOptions } from '@/lib/apple-wallet';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';

export const dynamic = 'force-dynamic';

interface PassRequestParams {
  name: string;
  eventName: string;
  email?: string;
  phone?: string;
  country?: string;
  postCode?: string;
  venue?: string;
  eventDate?: string;
  brandParam?: string;
  campaignParam?: string;
  brandLabel?: string;
}

async function handlePassGeneration(params: PassRequestParams) {
  const {
    name,
    eventName,
    email,
    phone,
    country,
    postCode,
    venue,
    eventDate,
    brandParam,
    campaignParam,
  } = params;

  let brandLabel = params.brandLabel;
  const themeOverride: PassThemingOptions = {
    brand: brandParam,
    brandLabel,
  };

  if (brandParam) {
    const resolvedBrand = await resolveBrand(brandParam);
    if (resolvedBrand) {
      const brandConfig = await getBrandConfig(resolvedBrand);
      if (brandConfig?.label && !brandLabel) {
        brandLabel = brandConfig.label;
        themeOverride.brandLabel = brandConfig.label;
      }

      // Pull design tokens from landing page config if campaign is supplied
      if (campaignParam) {
        const page = await getLandingPageBySlug(resolvedBrand, campaignParam);
        if (page) {
          themeOverride.brandLabel = page.title || brandLabel;
          if (page.design?.primaryColor) {
            themeOverride.labelColor = page.design.primaryColor;
          }
          if (page.design?.cardBackgroundColor) {
            themeOverride.backgroundColor = page.design.cardBackgroundColor;
          }
        }
      }
    }
  }

  if (!isAppleWalletConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error: 'Apple Wallet signing credentials not yet configured in environment.',
        instructions:
          'To enable automatic Apple Wallet pass generation, configure HAHO_PASS_TYPE_IDENTIFIER or APPLE_PASS_TYPE_IDENTIFIER in environment settings.',
      },
      { status: 501 }
    );
  }

  const passBuffer = await createAppleWalletPass(
    {
      name,
      eventName,
      email,
      phone,
      country,
      postCode,
      venue,
      eventDate,
      brandLabel: brandLabel || 'Haho.ai Events',
      ticketType: 'Official Event Entry Pass',
    },
    themeOverride
  );

  const safeFilename = `event-pass-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'attendee'}.pkpass`;

  return new NextResponse(passBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    return await handlePassGeneration({
      name: String(body.name || '').trim(),
      eventName: String(body.eventName || 'Official Event Pass').trim(),
      email: body.email ? String(body.email).trim() : undefined,
      phone: body.phone ? String(body.phone).trim() : undefined,
      country: body.country ? String(body.country).trim() : undefined,
      postCode: body.postCode ? String(body.postCode).trim() : undefined,
      venue: body.venue ? String(body.venue).trim() : undefined,
      eventDate: body.eventDate ? String(body.eventDate).trim() : undefined,
      brandParam: body.brand ? String(body.brand).trim() : undefined,
      campaignParam: body.campaign ? String(body.campaign).trim() : undefined,
      brandLabel: body.brandLabel ? String(body.brandLabel).trim() : undefined,
    });
  } catch (err: any) {
    console.error('[wallet-pass-route] Error generating pass via POST:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate Apple Wallet pass' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    return await handlePassGeneration({
      name: String(searchParams.get('name') || '').trim(),
      eventName: String(searchParams.get('eventName') || 'Official Event Pass').trim(),
      email: searchParams.get('email') ? String(searchParams.get('email')).trim() : undefined,
      phone: searchParams.get('phone') ? String(searchParams.get('phone')).trim() : undefined,
      country: searchParams.get('country') ? String(searchParams.get('country')).trim() : undefined,
      postCode: searchParams.get('postCode') ? String(searchParams.get('postCode')).trim() : undefined,
      venue: searchParams.get('venue') ? String(searchParams.get('venue')).trim() : undefined,
      eventDate: searchParams.get('eventDate') ? String(searchParams.get('eventDate')).trim() : undefined,
      brandParam: searchParams.get('brand') ? String(searchParams.get('brand')).trim() : undefined,
      campaignParam: searchParams.get('campaign') ? String(searchParams.get('campaign')).trim() : undefined,
      brandLabel: searchParams.get('brandLabel') ? String(searchParams.get('brandLabel')).trim() : undefined,
    });
  } catch (err: any) {
    console.error('[wallet-pass-route] Error generating pass via GET:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate Apple Wallet pass' },
      { status: 500 }
    );
  }
}
