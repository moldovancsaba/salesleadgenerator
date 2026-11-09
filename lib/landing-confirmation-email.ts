import { Resend } from 'resend';
import { createGoogleWalletSaveUrl } from './google-wallet';

export function resolveLandingFromAddress(brand: string, fromEmail?: string): string {
  if (fromEmail) return fromEmail;
  const domain = process.env.RESEND_OUTBOUND_DOMAIN || 'haho.ai';
  return `${brand}@${domain}`;
}

export interface LandingConfirmationEmailOptions {
  brand: string;
  brandLabel?: string;
  campaign?: string;
  campaignTitle?: string;
  recipientEmail: string;
  recipientName: string;
  phone?: string;
  country?: string;
  postCode?: string;
  venue?: string;
  eventDate?: string;
  fromEmail?: string;
}

export interface LandingConfirmationEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Builds and dispatches a responsive confirmation email with Apple Wallet,
 * Google Wallet, and event badge download links.
 */
export async function sendLandingConfirmationEmail(
  options: LandingConfirmationEmailOptions
): Promise<LandingConfirmationEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[landing-confirmation-email] RESEND_API_KEY is not configured; skipping email dispatch.');
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const {
    brand,
    brandLabel = 'Event Host',
    campaign,
    campaignTitle = 'Event Entry Confirmation',
    recipientEmail,
    recipientName,
    phone,
    country,
    postCode,
    venue = 'WV Active Aldersley, Wolverhampton',
    eventDate = 'November 2026',
    fromEmail,
  } = options;

  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { sent: false, error: 'Invalid recipient email' };
  }

  const baseUrl = (process.env.NEXTAUTH_URL || 'https://sales.haho.ai').replace(/\/$/, '');

  // 1. Build Apple Wallet download URL
  const applePassParams = new URLSearchParams({
    name: recipientName,
    eventName: campaignTitle,
    brand,
    brandLabel,
    ...(campaign ? { campaign } : {}),
    ...(recipientEmail ? { email: recipientEmail } : {}),
    ...(phone ? { phone } : {}),
    ...(country ? { country } : {}),
    ...(postCode ? { postCode } : {}),
    venue,
    eventDate,
  });
  const appleWalletUrl = `${baseUrl}/api/wallet/pass?${applePassParams.toString()}`;

  // 2. Build Event Badge image download URL
  const badgeParams = new URLSearchParams({
    name: recipientName,
    eventName: campaignTitle,
    brand,
    brandLabel,
    ...(campaign ? { campaign } : {}),
    ...(recipientEmail ? { email: recipientEmail } : {}),
    ...(phone ? { phone } : {}),
    venue,
    eventDate,
  });
  const badgeImageUrl = `${baseUrl}/api/badge?${badgeParams.toString()}`;

  // 3. Build Google Wallet save URL
  const googleWalletUrl = createGoogleWalletSaveUrl({
    name: recipientName,
    eventName: campaignTitle,
    eventDate,
    venue,
    email: recipientEmail,
    phone,
    brandLabel,
  }) || badgeImageUrl;

  // 4. Resolve sender
  const fromAddress = resolveLandingFromAddress(brand, fromEmail);
  const subject = `Entry Confirmed: ${campaignTitle} — Your Event Pass`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d1117; color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0d1117; width: 100%;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #161b22; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; background: linear-gradient(135deg, #090d16 0%, #161b22 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.08); text-align: center;">
              <div style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #f59e0b; text-transform: uppercase; margin-bottom: 8px;">
                ${escapeHtml(brandLabel)}
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.3;">
                ${escapeHtml(campaignTitle)}
              </h1>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 17px; line-height: 1.5; color: #ffffff;">
                Hello <strong>${escapeHtml(recipientName)}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #9ca3af;">
                Thank you for your submission! Your entry has been recorded. Below you will find your official attendee pass and direct links to save it to your phone for instant check-in.
              </p>

              <!-- Event Details Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px; background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 12px; font-weight: 700; color: #34d399; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                      Attendee Details
                    </div>
                    <div style="font-size: 15px; font-weight: 600; color: #f3f4f6; margin-bottom: 8px;">
                      ${escapeHtml(recipientName)} (${escapeHtml(recipientEmail)})
                    </div>
                    <div style="font-size: 13px; color: #9ca3af;">
                      <strong>Venue:</strong> ${escapeHtml(venue)}<br>
                      <strong>Date:</strong> ${escapeHtml(eventDate)}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Badge Preview Image -->
              <div style="text-align: center; margin-bottom: 28px;">
                <a href="${escapeHtml(badgeImageUrl)}" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="${escapeHtml(badgeImageUrl)}" alt="Attendee Event Badge QR Code" width="280" style="width: 280px; max-width: 100%; height: auto; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);" />
                </a>
                <div style="font-size: 12px; color: #6b7280; margin-top: 8px;">
                  Tap the badge image to view or download full resolution
                </div>
              </div>

              <!-- CTA Buttons Section -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <!-- Apple Wallet Button -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="${escapeHtml(appleWalletUrl)}" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: #000000; color: #ffffff; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; border: 1px solid rgba(255, 255, 255, 0.25);">
                       Add to Apple Wallet (.pkpass)
                    </a>
                  </td>
                </tr>

                <!-- Google Wallet Button -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="${escapeHtml(googleWalletUrl)}" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: #1f2937; color: #ffffff; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; border: 1px solid rgba(255, 255, 255, 0.15);">
                      Save to Google Wallet
                    </a>
                  </td>
                </tr>

                <!-- Save Badge PNG Button -->
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(badgeImageUrl)}" download="event-badge.svg" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: #00a862; color: #ffffff; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none;">
                      Save Event Badge Image
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 32px 0 0 0; font-size: 13px; line-height: 1.6; color: #6b7280; text-align: center;">
                Show your pass or badge QR code to the hostess at the entrance for direct verification and fast-track entry.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #0d1117; border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: center; font-size: 12px; color: #4b5563;">
              © ${new Date().getFullYear()} ${escapeHtml(brandLabel)}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const resend = new Resend(apiKey);
    const data = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });

    return { sent: true, messageId: data.data?.id };
  } catch (err: any) {
    console.error('[landing-confirmation-email] Failed to send email via Resend:', err);
    return { sent: false, error: err?.message || 'Failed to dispatch email' };
  }
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
