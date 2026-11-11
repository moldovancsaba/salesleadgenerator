import crypto from 'crypto';

export interface GoogleWalletPassData {
  name: string;
  eventName: string;
  eventDate?: string;
  venue?: string;
  email?: string;
  phone?: string;
  brandLabel?: string;
  ticketType?: string;
  barcodeValue?: string;
}

/**
 * Checks if Google Wallet credentials are provided in the environment.
 * Requires GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL, and GOOGLE_WALLET_PRIVATE_KEY.
 */
export function isGoogleWalletConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_WALLET_ISSUER_ID || process.env.HAHO_GOOGLE_WALLET_ISSUER_ID) &&
      (process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
      (process.env.GOOGLE_WALLET_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY)
  );
}

/**
 * Creates a signed JWT 'Save to Google Wallet' URL if credentials exist,
 * or returns a fallback web link if not yet configured.
 */
export function createGoogleWalletSaveUrl(
  data: GoogleWalletPassData,
  origins: string[] = ['https://sales.haho.ai']
): string | null {
  const issuerId = (
    process.env.GOOGLE_WALLET_ISSUER_ID ||
    process.env.HAHO_GOOGLE_WALLET_ISSUER_ID ||
    ''
  ).trim();

  const clientEmail = (
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    ''
  ).trim();

  let privateKey = (
    process.env.GOOGLE_WALLET_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    ''
  ).trim();

  if (!issuerId || !clientEmail || !privateKey) {
    return null;
  }

  // Handle formatted private key strings with literal \n
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const cleanEmail = (data.email || 'attendee').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const classId = `${issuerId}.haho_event_generic_class`;
  const objectId = `${issuerId}.pass_${cleanEmail}_${Date.now()}`;

  const barcodeValue = data.barcodeValue || (data.email ? `EMAIL:${data.email}` : `ATTENDEE:${data.name}`);

  const payload = {
    iss: clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins,
    payload: {
      genericClasses: [
        {
          id: classId,
          cardTemplateOverride: {
            cardRowTemplateInfos: [
              {
                twoItems: {
                  startItem: {
                    firstValue: {
                      fields: [
                        {
                          fieldPath: "object.textModulesData['event_date']",
                        },
                      ],
                    },
                  },
                  endItem: {
                    firstValue: {
                      fields: [
                        {
                          fieldPath: "object.textModulesData['venue']",
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ],
      genericObjects: [
        {
          id: objectId,
          classId,
          state: 'ACTIVE',
          cardTitle: {
            defaultValue: {
              language: 'en',
              value: data.brandLabel || 'Haho.ai Events',
            },
          },
          header: {
            defaultValue: {
              language: 'en',
              value: data.eventName || 'Official Event Entry Pass',
            },
          },
          subheader: {
            defaultValue: {
              language: 'en',
              value: data.name || 'Attendee',
            },
          },
          barcode: {
            type: 'QR_CODE',
            value: barcodeValue,
            alternateText: data.name || 'Event Attendee',
          },
          textModulesData: [
            {
              id: 'event_date',
              header: 'DATE',
              body: data.eventDate || 'Date to be confirmed',
            },
            {
              id: 'venue',
              header: 'LOCATION',
              body: data.venue || 'Event Venue',
            },
          ],
        },
      ],
    },
  };

  try {
    const token = signRs256Jwt(payload, privateKey);
    return `https://pay.google.com/gp/v/save/${token}`;
  } catch (err) {
    console.error('[GoogleWallet] Error signing JWT for Google Wallet:', err);
    return null;
  }
}

/**
 * Signs a JWT using Node's crypto RS256 algorithm without external dependencies.
 */
function signRs256Jwt(payload: Record<string, unknown>, privateKeyPem: string): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}
