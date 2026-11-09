import { NextRequest, NextResponse } from 'next/server';
import { isAppleWalletConfigured, createAppleWalletPass, PassThemingOptions } from '@/lib/apple-wallet';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const name = String(body.name || '').trim();
    const eventName = String(body.eventName || 'Official Event Pass').trim();
    const email = body.email ? String(body.email).trim() : undefined;
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const country = body.country ? String(body.country).trim() : undefined;
    const postCode = body.postCode ? String(body.postCode).trim() : undefined;
    const venue = body.venue ? String(body.venue).trim() : undefined;
    const eventDate = body.eventDate ? String(body.eventDate).trim() : undefined;
    const brandParam = body.brand ? String(body.brand).trim() : undefined;
    const campaignParam = body.campaign ? String(body.campaign).trim() : undefined;

    // Resolve brand configuration & dynamic theming
    let brandLabel = body.brandLabel ? String(body.brandLabel).trim() : undefined;
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
          instructions: 'To enable automatic Apple Wallet pass generation, configure HAHO_PASS_TYPE_IDENTIFIER or APPLE_PASS_TYPE_IDENTIFIER in environment settings.',
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
  } catch (err: any) {
    console.error('[wallet-pass-route] Error generating pass:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate Apple Wallet pass' },
      { status: 500 }
    );
  }
}
