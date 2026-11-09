import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { buildVCardString, AttendeeCardData } from '@/lib/attendee-card';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';

export const dynamic = 'force-dynamic';

function getSvgBadge(data: AttendeeCardData, qrSvg: string): string {
  const brandTitle = (data.brandLabel || 'MR VEGAS').toUpperCase();
  const eventName = data.eventName || 'Grand Slam of Darts';
  const attendeeName = data.name || 'Event Attendee';
  const venue = data.venue || 'WV Active Aldersley, Wolverhampton';
  const eventDate = data.eventDate || 'November 2026';

  // Embed the QR SVG cleanly
  // qrSvg starts with <svg ...>, extract inner content or embed as nested svg
  const cleanQr = qrSvg.replace(/<\?xml.*?\?>/, '').replace(/<!DOCTYPE.*?>/, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1117" />
      <stop offset="50%" stop-color="#161b22" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="24" flood-color="#00a862" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Dark Background -->
  <rect width="800" height="1200" fill="url(#bgGrad)" />

  <!-- Outer Card Frame -->
  <rect x="24" y="24" width="752" height="1152" rx="24" fill="none" stroke="rgba(255, 255, 255, 0.12)" stroke-width="2" />

  <!-- Accent Corners -->
  <path d="M 24 104 L 24 24 L 104 24" fill="none" stroke="#00a862" stroke-width="4" />
  <path d="M 776 1096 L 776 1176 L 696 1176" fill="none" stroke="#00a862" stroke-width="4" />

  <!-- Brand & Event Header -->
  <text x="400" y="75" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" font-size="24" fill="#f59e0b" letter-spacing="1">
    ${escapeXml(brandTitle)}
  </text>
  <text x="400" y="112" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="bold" font-size="22" fill="#ffffff">
    ${escapeXml(eventName)}
  </text>

  <!-- Attendee Details -->
  <text x="400" y="165" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="800" font-size="14" fill="#34d399" letter-spacing="2">
    EVENT PASS ATTENDEE
  </text>
  <text x="400" y="210" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" font-size="38" fill="#ffffff">
    ${escapeXml(attendeeName)}
  </text>

  <!-- Maximized QR Container Box -->
  <rect x="80" y="250" width="640" height="640" rx="28" fill="#ffffff" filter="url(#cardShadow)" />

  <!-- QR Code Placement -->
  <g transform="translate(100, 270)">
    <svg width="600" height="600" viewBox="0 0 600 600">
      ${cleanQr}
    </svg>
  </g>

  <!-- Instruction Text -->
  <text x="400" y="945" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="bold" font-size="20" fill="#34d399">
    SCAN WITH CAMERA FOR CONTACT CARD
  </text>
  <text x="400" y="980" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="500" font-size="15" fill="#9ca3af">
    Hostess can scan this QR code directly into pipeline (vCard)
  </text>

  <!-- Footer Info -->
  <text x="400" y="1150" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="500" font-size="13" fill="#64748b">
    ${escapeXml(venue)} • ${escapeXml(eventDate)}
  </text>
</svg>`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name') || 'Event Attendee';
    const email = searchParams.get('email') || undefined;
    const phone = searchParams.get('phone') || undefined;
    const brand = searchParams.get('brand') || undefined;
    const campaign = searchParams.get('campaign') || undefined;
    const eventName = searchParams.get('eventName') || 'Official Event Pass';
    const venue = searchParams.get('venue') || 'WV Active Aldersley, Wolverhampton';
    const eventDate = searchParams.get('eventDate') || 'November 2026';

    let brandLabel = searchParams.get('brandLabel') || undefined;

    if (brand) {
      const resolved = await resolveBrand(brand);
      if (resolved) {
        const config = await getBrandConfig(resolved);
        if (config?.label && !brandLabel) {
          brandLabel = config.label;
        }
        if (campaign) {
          const page = await getLandingPageBySlug(resolved, campaign);
          if (page) {
            brandLabel = page.title || brandLabel;
          }
        }
      }
    }

    const attendeeData: AttendeeCardData = {
      name,
      email,
      phone,
      eventName,
      venue,
      eventDate,
      brandLabel: brandLabel || 'Mr Vegas',
    };

    const vCard = buildVCardString(attendeeData);
    const qrSvg = await QRCode.toString(vCard, {
      type: 'svg',
      margin: 1,
      width: 600,
      errorCorrectionLevel: 'L',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    const fullSvg = getSvgBadge(attendeeData, qrSvg);
    const safeFilename = `event-badge-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'attendee'}.svg`;

    return new NextResponse(fullSvg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('[API:badge] Error generating badge SVG:', err);
    return NextResponse.json({ error: 'Failed to generate badge' }, { status: 500 });
  }
}
