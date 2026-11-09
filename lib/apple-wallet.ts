import path from 'path';
import fs from 'fs';
import { PKPass, PassType } from 'passkit-generator';
import { buildVCardString, AttendeeCardData } from './attendee-card';

export interface WalletPassConfig {
  passTypeIdentifier?: string;
  teamIdentifier?: string;
  wwdrCert?: string; // PEM or base64 string
  signerCert?: string; // PEM or base64 string
  signerKey?: string; // PEM or base64 string
  signerKeyPassphrase?: string;
}

/**
 * Checks whether the server environment has Apple Wallet pass signing credentials configured.
 */
export function isAppleWalletConfigured(): boolean {
  return Boolean(
    process.env.APPLE_PASS_TYPE_IDENTIFIER &&
    process.env.APPLE_TEAM_IDENTIFIER &&
    process.env.APPLE_SIGNER_CERT &&
    process.env.APPLE_SIGNER_KEY
  );
}

/**
 * Creates an Apple Wallet (.pkpass) buffer for an event attendee pass.
 */
export async function createAppleWalletPass(data: AttendeeCardData): Promise<Buffer> {
  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.com.mrvegas.eventpass';
  const teamIdentifier = process.env.APPLE_TEAM_IDENTIFIER || 'TEAMID123';
  const signerCert = process.env.APPLE_SIGNER_CERT ? Buffer.from(process.env.APPLE_SIGNER_CERT, 'base64').toString('utf8') : '';
  const signerKey = process.env.APPLE_SIGNER_KEY ? Buffer.from(process.env.APPLE_SIGNER_KEY, 'base64').toString('utf8') : '';
  const wwdrCert = process.env.APPLE_WWDR_CERT ? Buffer.from(process.env.APPLE_WWDR_CERT, 'base64').toString('utf8') : '';
  const signerKeyPassphrase = process.env.APPLE_SIGNER_KEY_PASSPHRASE || process.env.APPLE_SIGNER_KEY_PASSWORD || '';

  const vCard = buildVCardString(data);

  // Bundle pass icons if available
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
      teamIdentifier,
      organizationName: data.brandLabel || 'Mr Vegas',
      description: `${data.eventName} Event Pass`,
      logoText: data.brandLabel || 'Mr Vegas',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(13, 17, 23)',
      labelColor: 'rgb(52, 211, 153)', // emerald green
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
    value: data.eventName,
  });
  ticketType.auxiliaryFields.push({
    key: 'venue',
    label: 'VENUE',
    value: data.venue || 'WV Active Aldersley',
  });
  if (data.eventDate) {
    ticketType.auxiliaryFields.push({
      key: 'date',
      label: 'DATE',
      value: data.eventDate,
    });
  }
  ticketType.backFields.push(
    {
      key: 'contact',
      label: 'CONTACT CARD (vCard)',
      value: vCard,
    },
    {
      key: 'disclaimer',
      label: 'TERMS & CONDITIONS',
      value: 'Official giveaway pass. Non-transferable. Must be 18+ to enter.',
    }
  );

  pass.types.push(ticketType);

  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: vCard,
    messageEncoding: 'utf-8',
    altText: data.name,
  });

  return pass.getAsBuffer();
}
