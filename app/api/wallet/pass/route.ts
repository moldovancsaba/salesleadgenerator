import { NextRequest, NextResponse } from 'next/server';
import { isAppleWalletConfigured, createAppleWalletPass } from '@/lib/apple-wallet';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const name = String(body.name || '').trim();
    const eventName = String(body.eventName || 'Mr Vegas Event').trim();
    const email = body.email ? String(body.email).trim() : undefined;
    const phone = body.phone ? String(body.phone).trim() : undefined;
    const country = body.country ? String(body.country).trim() : undefined;
    const postCode = body.postCode ? String(body.postCode).trim() : undefined;
    const venue = body.venue ? String(body.venue).trim() : 'WV Active Aldersley, Wolverhampton';
    const brandLabel = body.brandLabel ? String(body.brandLabel).trim() : 'Mr Vegas';

    if (!isAppleWalletConfigured()) {
      return NextResponse.json(
        {
          configured: false,
          error: 'Apple Wallet signing credentials not yet configured in environment.',
          instructions: 'To enable automatic Apple Wallet pass generation, add APPLE_PASS_TYPE_IDENTIFIER, APPLE_TEAM_IDENTIFIER, APPLE_SIGNER_CERT and APPLE_SIGNER_KEY.',
        },
        { status: 501 }
      );
    }

    const passBuffer = await createAppleWalletPass({
      name,
      eventName,
      email,
      phone,
      country,
      postCode,
      venue,
      brandLabel,
      ticketType: 'Official Event Entry Pass',
    });

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
