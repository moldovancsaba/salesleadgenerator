import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { buildVCardString, AttendeeCardData } from '@/lib/attendee-card';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';

export const dynamic = 'force-dynamic';

function getSvgBadge(data: AttendeeCardData, qrSvg: string): string {
  const brandTitle = (data.brandLabel || data.eventName || 'EVENT').toUpperCase();
  const eventName = data.eventName || 'Event pass';
  const attendeeName = data.name || 'Event Attendee';
  const venue = data.venue || '';
  const eventDate = data.eventDate || '';

  // Embed the QR SVG cleanly
  // qrSvg starts with <svg ...>, extract inner content or embed as nested svg
  const cleanQr = qrSvg.replace(/<\?xml.*?\?>/, '').replace(/<!DOCTYPE.*?>/, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${EVENT_PASS_COLORS.page}" />
      <stop offset="50%" stop-color="${EVENT_PASS_COLORS.card}" />
      <stop offset="100%" stop-color="${EVENT_PASS_COLORS.gradientEnd}" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="24" flood-color="${EVENT_PASS_COLORS.primary}" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Dark Background -->
  <rect width="800" height="1200" fill="url(#bgGrad)" />

  <!-- Outer Card Frame -->
  <rect x="24" y="24" width="752" height="1152" rx="24" fill="none" stroke="${EVENT_PASS_COLORS.borderFrame}" stroke-width="2" />

  <!-- Accent Corners -->
  <path d="M 24 104 L 24 24 L 104 24" fill="none" stroke="${EVENT_PASS_COLORS.primary}" stroke-width="4" />
  <path d="M 776 1096 L 776 1176 L 696 1176" fill="none" stroke="${EVENT_PASS_COLORS.primary}" stroke-width="4" />

  <!-- Brand & Event Header -->
  <text x="400" y="75" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" font-size="24" fill="${EVENT_PASS_COLORS.amber}" letter-spacing="1">
    ${escapeXml(brandTitle)}
  </text>
  <text x="400" y="112" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="bold" font-size="22" fill="${EVENT_PASS_COLORS.white}">
    ${escapeXml(eventName)}
  </text>

  <!-- Attendee Details -->
  <text x="400" y="165" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="800" font-size="14" fill="${EVENT_PASS_COLORS.accent}" letter-spacing="2">
    EVENT PASS ATTENDEE
  </text>
  <text x="400" y="210" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" font-size="38" fill="${EVENT_PASS_COLORS.white}">
    ${escapeXml(attendeeName)}
  </text>

  <!-- Maximized QR Container Box -->
  <rect x="80" y="250" width="640" height="640" rx="28" fill="${EVENT_PASS_COLORS.white}" filter="url(#cardShadow)" />

  <!-- QR Code Placement -->
  <g transform="translate(100, 270)">
    <svg width="600" height="600" viewBox="0 0 600 600">
      ${cleanQr}
    </svg>
  </g>

  <!-- Instruction Text -->
  <text x="400" y="945" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="bold" font-size="20" fill="${EVENT_PASS_COLORS.accent}">
    SCAN WITH CAMERA FOR CONTACT CARD
  </text>
  <text x="400" y="980" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="500" font-size="15" fill="${EVENT_PASS_COLORS.textMuted}">
    Hostess can scan this QR code directly into pipeline (vCard)
  </text>

  <!-- Footer Info -->
  <text x="400" y="1150" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="500" font-size="13" fill="${EVENT_PASS_COLORS.textSubtle}">
    ${escapeXml([venue, eventDate].filter(Boolean).join(' • '))}
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
    const venue = searchParams.get('venue') || '';
    const eventDate = searchParams.get('eventDate') || '';

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
      brandLabel: brandLabel || undefined,
    };

    const vCard = buildVCardString(attendeeData);
    const qrSvg = await QRCode.toString(vCard, {
      type: 'svg',
      margin: 1,
      width: 600,
      errorCorrectionLevel: 'L',
      color: {
        dark: EVENT_PASS_COLORS.black,
        light: EVENT_PASS_COLORS.white,
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
