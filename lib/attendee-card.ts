/**
 * Attendee pass content shared by the badge image, vCard, calendar entry, wallet passes and confirmation email.
 * The badge QR code is the vCard built here; the check-in scanner reads it back. Event name, venue and date come
 * from the landing page's `event` settings; this module carries no campaign defaults.
 */
import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import QRCode from 'qrcode';

export interface AttendeeCardData {
  name: string;
  eventName: string;
  eventDate?: string;
  venue?: string;
  email?: string;
  phone?: string;
  country?: string;
  postCode?: string;
  logoUrl?: string;
  brandLabel?: string;
  ticketType?: string;
}

/**
 * Builds standard vCard 3.0 format for hostess phone / contact scanning.
 * Standard iOS & Android camera / QR reader recognizes vCard instantly as a contact card.
 */
export function buildVCardString(data: AttendeeCardData): string {
  const parts = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${data.name || 'Event Attendee'}`,
  ];

  if (data.email) {
    parts.push(`EMAIL:${data.email}`);
  }
  if (data.phone) {
    parts.push(`TEL:${data.phone}`);
  }
  if (data.eventName || data.brandLabel) {
    parts.push(`ORG:${data.brandLabel || data.eventName}`);
  }
  parts.push('END:VCARD');
  return parts.join('\r\n');
}

/**
 * Returns a downloadable vCard Data URI for saving directly to phone contacts.
 */
export function buildVCardDataUri(data: AttendeeCardData): string {
  const vCard = buildVCardString(data);
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(vCard)}`;
}

/**
 * Builds an iCalendar (.ics) string for adding the event and pass to Apple Calendar / Google Calendar.
 */
export function buildCalendarIcsDataUri(data: AttendeeCardData): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sales Lead Generator//Event Pass//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:pass-${Date.now()}@salesleadgenerator`,
    `DTSTAMP:${now}`,
    `SUMMARY:${data.eventName || 'Event Entry Pass'}`,
    `DESCRIPTION:${data.brandLabel || data.eventName || 'Event'} Entry Pass for ${data.name || 'Attendee'}.${data.venue ? ` Venue: ${data.venue}` : ''}`,
    ...(data.venue ? [`LOCATION:${data.venue}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsLines.join('\r\n'))}`;
}

/**
 * Generates an event attendee contact badge PNG image via client-side canvas.
 * Dimensions: 800 x 1200 px (standard high-res portrait ratio for easy saving to phone gallery).
 */
export async function generateAttendeeBadgePng(data: AttendeeCardData): Promise<string> {
  const vCard = buildVCardString(data);
  const qrDataUrl = await QRCode.toDataURL(vCard, {
    margin: 1,
    width: 640,
    errorCorrectionLevel: 'L',
    color: {
      dark: EVENT_PASS_COLORS.black,
      light: EVENT_PASS_COLORS.white,
    },
  });

  const width = 800;
  const height = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // 1. Dark Premium Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, EVENT_PASS_COLORS.page);
  bgGrad.addColorStop(0.5, EVENT_PASS_COLORS.card);
  bgGrad.addColorStop(1, EVENT_PASS_COLORS.gradientEnd);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Border Card Frame
  ctx.save();
  ctx.strokeStyle = EVENT_PASS_COLORS.borderFrame;
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, width - 48, height - 48, 24);
  ctx.stroke();
  ctx.restore();

  // Accent Corner Ornaments
  ctx.fillStyle = EVENT_PASS_COLORS.primary;
  ctx.fillRect(24, 24, 80, 4);
  ctx.fillRect(24, 24, 4, 80);
  ctx.fillRect(width - 104, height - 28, 80, 4);
  ctx.fillRect(width - 28, height - 104, 4, 80);

  // 3. Compact Header
  let currentY = 55;

  ctx.fillStyle = EVENT_PASS_COLORS.amber;
  ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((data.brandLabel || data.eventName || 'EVENT').toUpperCase(), width / 2, currentY);

  currentY += 32;

  ctx.fillStyle = EVENT_PASS_COLORS.white;
  ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.eventName || 'Event pass', width / 2, currentY);

  currentY += 45;

  // 4. Attendee Name (Prominent & Clear)
  ctx.fillStyle = EVENT_PASS_COLORS.accent;
  ctx.font = '800 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('EVENT PASS ATTENDEE', width / 2, currentY);

  currentY += 36;
  ctx.fillStyle = EVENT_PASS_COLORS.white;
  ctx.font = '900 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.name || 'Guest Attendee', width / 2, currentY);

  currentY += 35;

  // 5. MAXIMIZED White Container Card for QR Code (fills maximum width/height)
  const qrBoxSize = 640;
  const qrBoxX = (width - qrBoxSize) / 2;
  ctx.save();
  ctx.fillStyle = EVENT_PASS_COLORS.white;
  ctx.shadowColor = EVENT_PASS_COLORS.qrGlow;
  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, qrBoxX, currentY, qrBoxSize, qrBoxSize, 28);
  ctx.fill();
  ctx.restore();

  // Draw QR code onto white container edge-to-edge
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, qrBoxX + 16, currentY + 16, qrBoxSize - 32, qrBoxSize - 32);

  currentY += qrBoxSize + 40;

  // 6. Hostess Scanning Instructions
  ctx.fillStyle = EVENT_PASS_COLORS.accent;
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCAN WITH CAMERA FOR CONTACT CARD', width / 2, currentY);

  currentY += 28;
  ctx.fillStyle = EVENT_PASS_COLORS.textMuted;
  ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Hostess can scan this QR code directly into pipeline (vCard)', width / 2, currentY);

  // 7. Footer: Venue & Date
  const footerY = height - 45;
  const details = [data.venue, data.eventDate].filter(Boolean).join(' • ');
  ctx.fillStyle = EVENT_PASS_COLORS.textSubtle;
  ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(details, width / 2, footerY);

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let lineY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, lineY);
      line = words[n] + ' ';
      lineY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, lineY);
}
