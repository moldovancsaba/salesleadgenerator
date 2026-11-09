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
    parts.push(`EMAIL;TYPE=INTERNET:${data.email}`);
  }
  if (data.phone) {
    parts.push(`TEL;TYPE=CELL:${data.phone}`);
  }
  if (data.country || data.postCode) {
    parts.push(`ADR;TYPE=HOME:;;;${data.postCode || ''};;${data.country || ''}`);
  }
  if (data.eventName) {
    parts.push(`ORG:${data.brandLabel || 'Event Organizer'}`);
    parts.push(`TITLE:${data.ticketType || 'Event Attendee'}`);
    parts.push(`NOTE:Registered for ${data.eventName}${data.venue ? ' at ' + data.venue : ''}`);
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
    `DESCRIPTION:${data.brandLabel || 'Mr Vegas'} Entry Pass for ${data.name || 'Attendee'}. Venue: ${data.venue || 'WV Active Aldersley'}`,
    `LOCATION:${data.venue || 'WV Active Aldersley, Wolverhampton'}`,
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
    width: 320,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
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
  bgGrad.addColorStop(0, '#0d1117');
  bgGrad.addColorStop(0.5, '#161b22');
  bgGrad.addColorStop(1, '#090d16');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Border Card Frame
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  roundRect(ctx, 30, 30, width - 60, height - 60, 28);
  ctx.stroke();
  ctx.restore();

  // Accent Corner Ornaments
  ctx.fillStyle = '#00a862';
  ctx.fillRect(30, 30, 80, 4);
  ctx.fillRect(30, 30, 4, 80);
  ctx.fillRect(width - 110, height - 34, 80, 4);
  ctx.fillRect(width - 34, height - 110, 4, 80);

  // 3. Header: Brand & Event Badge
  let currentY = 90;

  // Top pill badge
  ctx.save();
  ctx.fillStyle = 'rgba(0, 168, 98, 0.15)';
  ctx.strokeStyle = '#00a862';
  ctx.lineWidth = 1.5;
  roundRect(ctx, width / 2 - 130, currentY, 260, 38, 19);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OFFICIAL EVENT PASS', width / 2, currentY + 19);
  ctx.restore();

  currentY += 80;

  // Optional Logo Image
  if (data.logoUrl) {
    try {
      const img = await loadImage(data.logoUrl);
      const maxW = 380;
      const maxH = 100;
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const imgW = img.width * ratio;
      const imgH = img.height * ratio;
      ctx.drawImage(img, (width - imgW) / 2, currentY, imgW, imgH);
      currentY += imgH + 25;
    } catch {
      // Fallback to text banner if remote image fails
      ctx.fillStyle = '#f59e0b';
      ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data.brandLabel?.toUpperCase() || 'MR VEGAS', width / 2, currentY + 20);
      currentY += 50;
    }
  } else {
    ctx.fillStyle = '#f59e0b';
    ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data.brandLabel?.toUpperCase() || 'MR VEGAS', width / 2, currentY + 20);
    currentY += 50;
  }

  // Event Name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  wrapText(ctx, data.eventName, width / 2, currentY, 680, 34);
  currentY += 70;

  // Divider Line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, currentY);
  ctx.lineTo(width - 80, currentY);
  ctx.stroke();

  currentY += 40;

  // 4. Attendee Name (Prominent & Clear)
  ctx.fillStyle = '#9ca3af';
  ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ATTENDEE NAME', width / 2, currentY);

  currentY += 38;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.name || 'Guest Attendee', width / 2, currentY);

  currentY += 50;

  // 5. White Container Card for QR Code
  const qrBoxSize = 340;
  const qrBoxX = (width - qrBoxSize) / 2;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 168, 98, 0.35)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, qrBoxX, currentY, qrBoxSize, qrBoxSize, 24);
  ctx.fill();
  ctx.restore();

  // Draw QR code onto white container
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, qrBoxX + 20, currentY + 20, qrBoxSize - 40, qrBoxSize - 40);

  currentY += qrBoxSize + 40;

  // 6. Hostess Scanning Instructions
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCAN WITH CAMERA FOR CONTACT CARD', width / 2, currentY);

  currentY += 30;
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Hostess can scan this pass directly into phone contacts (vCard).', width / 2, currentY);

  // 7. Footer: Venue & Date
  const footerY = height - 70;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, footerY - 25);
  ctx.lineTo(width - 80, footerY - 25);
  ctx.stroke();

  const details = [data.venue, data.eventDate || 'WV Active Aldersley, Wolverhampton'].filter(Boolean).join(' • ');
  ctx.fillStyle = '#64748b';
  ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
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
