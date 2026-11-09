import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PKPass, PassType } from 'passkit-generator';
import { buildVCardString, AttendeeCardData } from './attendee-card';

export interface PassThemingOptions {
  brand?: string;
  brandLabel?: string;
  foregroundColor?: string; // e.g. "rgb(255, 255, 255)"
  backgroundColor?: string; // e.g. "rgb(13, 17, 23)"
  labelColor?: string; // e.g. "rgb(52, 211, 153)"
  iconPath?: string;
  logoPath?: string;
}

export interface WalletPassConfig {
  passTypeIdentifier?: string;
  teamIdentifier?: string;
  wwdrCert?: string;
  signerCert?: string;
  signerKey?: string;
  signerKeyPassphrase?: string;
}

/**
 * Checks whether Apple Wallet signing credentials are configured.
 * Haho.ai umbrella credentials serve as the default issuer for all clients.
 */
export function isAppleWalletConfigured(): boolean {
  return Boolean(
    (process.env.APPLE_PASS_TYPE_IDENTIFIER || process.env.HAHO_PASS_TYPE_IDENTIFIER) &&
    (process.env.APPLE_TEAM_IDENTIFIER || process.env.HAHO_TEAM_IDENTIFIER) &&
    (process.env.APPLE_SIGNER_CERT || process.env.HAHO_SIGNER_CERT) &&
    (process.env.APPLE_SIGNER_KEY || process.env.HAHO_SIGNER_KEY)
  );
}

/**
 * Resolves default theme colors for known brands.
 */
function resolveBrandTheme(brand?: string, brandLabel?: string): {
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  displayName: string;
} {
  const norm = (brand || '').toLowerCase();

  if (norm === 'vegas' || (brandLabel || '').toLowerCase().includes('vegas')) {
    return {
      backgroundColor: 'rgb(13, 17, 23)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(52, 211, 153)', // emerald green
      displayName: 'Mr Vegas',
    };
  }

  if (norm.includes('racket') || norm.includes('padel')) {
    return {
      backgroundColor: 'rgb(15, 23, 42)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(56, 189, 248)', // sky blue
      displayName: brandLabel || 'Racket.land',
    };
  }

  if (norm === 'seyu') {
    return {
      backgroundColor: 'rgb(24, 24, 27)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(251, 191, 36)', // gold/amber
      displayName: brandLabel || 'Seyu',
    };
  }

  if (norm === 'cogmap') {
    return {
      backgroundColor: 'rgb(17, 24, 39)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(129, 140, 248)', // indigo
      displayName: brandLabel || 'Cogmap',
    };
  }

  // Universal Haho.ai default theme
  return {
    backgroundColor: 'rgb(10, 15, 29)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(16, 185, 129)', // haho emerald
    displayName: brandLabel || 'Haho.ai Events',
  };
}

/**
 * Generates an Apple Wallet (.pkpass) binary buffer.
 * Dynamically cobrands the ticket with the client's event name, colors, and venue,
 * backed by Haho.ai's master signing certificates.
 */
export async function createAppleWalletPass(
  data: AttendeeCardData,
  themeOverride?: PassThemingOptions
): Promise<Buffer> {
  // Master umbrella credentials (fall back cleanly to current configured credentials)
  const passTypeIdentifier = (
    themeOverride?.brand === 'vegas' && process.env.APPLE_PASS_TYPE_IDENTIFIER
      ? process.env.APPLE_PASS_TYPE_IDENTIFIER
      : process.env.HAHO_PASS_TYPE_IDENTIFIER || process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.ai.haho.pass'
  ).trim();

  const teamIdentifier = (
    process.env.HAHO_TEAM_IDENTIFIER ||
    process.env.APPLE_TEAM_IDENTIFIER ||
    'TEAMID123'
  ).trim();

  const rawCert = process.env.HAHO_SIGNER_CERT || process.env.APPLE_SIGNER_CERT || '';
  const rawKey = process.env.HAHO_SIGNER_KEY || process.env.APPLE_SIGNER_KEY || '';
  const rawWwdr = process.env.HAHO_WWDR_CERT || process.env.APPLE_WWDR_CERT || '';

  const signerCert = rawCert ? Buffer.from(rawCert.trim(), 'base64').toString('utf8').trim() : '';
  const signerKey = rawKey ? Buffer.from(rawKey.trim(), 'base64').toString('utf8').trim() : '';
  const wwdrCert = rawWwdr ? Buffer.from(rawWwdr.trim(), 'base64').toString('utf8').trim() : '';
  const signerKeyPassphrase = (
    process.env.HAHO_SIGNER_KEY_PASSPHRASE ||
    process.env.APPLE_SIGNER_KEY_PASSPHRASE ||
    process.env.APPLE_SIGNER_KEY_PASSWORD ||
    ''
  ).trim();

  const vCard = buildVCardString(data);

  // Dynamic deterministic serial number
  const prefix = (themeOverride?.brand || data.brandLabel || 'HAHO')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const seed = (data.email || data.name || Date.now().toString()).trim().toLowerCase();
  const serialNumber = `${prefix}-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16).toUpperCase()}`;

  // Resolve visual branding and colors
  const theme = resolveBrandTheme(themeOverride?.brand, data.brandLabel);
  const backgroundColor = themeOverride?.backgroundColor || theme.backgroundColor;
  const foregroundColor = themeOverride?.foregroundColor || theme.foregroundColor;
  const labelColor = themeOverride?.labelColor || theme.labelColor;
  const organizationName = data.brandLabel || theme.displayName;

  // Bundle pass icon and logo assets
  const buffers: Record<string, Buffer> = {};
  try {
    const iconPath = path.join(process.cwd(), 'public/passes/icon.png');
    if (fs.existsSync(iconPath)) {
      buffers['icon.png'] = fs.readFileSync(iconPath);
      buffers['icon@2x.png'] = fs.readFileSync(path.join(process.cwd(), 'public/passes/icon@2x.png'));
      buffers['logo.png'] = fs.readFileSync(path.join(process.cwd(), 'public/passes/logo.png'));
      buffers['logo@2x.png'] = fs.readFileSync(path.join(process.cwd(), 'public/passes/logo@2x.png'));
    }
  } catch {
    // Non-fatal if asset files are loaded in different execution context
  }

  const pass = new PKPass(
    buffers,
    {
      signerCert,
      signerKey,
      wwdr: wwdrCert,
      signerKeyPassphrase: signerKeyPassphrase || undefined,
    },
    {
      formatVersion: 1,
      passTypeIdentifier,
      serialNumber,
      teamIdentifier,
      organizationName,
      description: `${data.eventName || 'Official Event'} Pass`,
      logoText: organizationName,
      foregroundColor,
      backgroundColor,
      labelColor,
    }
  );

  const ticketType = new PassType('eventTicket');
  ticketType.primaryFields.push({
    key: 'attendee',
    label: 'ATTENDEE',
    value: data.name || 'Guest',
  });
  ticketType.secondaryFields.push({
    key: 'event',
    label: 'EVENT',
    value: data.eventName || 'Official Event Entry',
  });

  // Note: auxiliaryFields (venue/date) are intentionally moved to backFields so the front of the pass
  // dedicates maximum vertical height and breathing room to render the QR code as large as possible.

  ticketType.backFields.push(
    {
      key: 'venue',
      label: 'VENUE',
      value: data.venue || 'Event Venue',
    },
    {
      key: 'date',
      label: 'DATE',
      value: data.eventDate || 'November 2026',
    },
    {
      key: 'organizer',
      label: 'ORGANIZER',
      value: organizationName,
    },
    {
      key: 'contact',
      label: 'CONTACT CARD (vCard)',
      value: vCard,
    },
    {
      key: 'platform',
      label: 'PASS ISSUER & TICKETING PLATFORM',
      value: 'Issued via haho.ai · Enterprise Sales Lead & Event Intelligence',
    },
    {
      key: 'disclaimer',
      label: 'TERMS & CONDITIONS',
      value: 'Official event entry pass. Non-transferable. Present QR code upon arrival to event hostess.',
    }
  );

  pass.types.push(ticketType);

  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: vCard,
    messageEncoding: 'utf-8',
    altText: data.name || 'Tap QR code to zoom',
  });

  return pass.getAsBuffer();
}
