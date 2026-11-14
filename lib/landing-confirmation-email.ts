import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import { Resend } from 'resend';
import { createGoogleWalletSaveUrl } from './google-wallet';
import { LandingPageConfirmationEmailConfig } from './landing-page-schema';

export function resolveLandingFromAddress(brand: string, fromEmail?: string): string {
  if (fromEmail) return fromEmail;
  const domain = process.env.RESEND_OUTBOUND_DOMAIN || 'haho.ai';
  return `${brand}@${domain}`;
}

export function resolveLandingBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://sales.haho.ai'
  ).replace(/\/$/, '');
}

function resolveEmailAssetUrl(url: string | undefined, baseUrl: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return `${baseUrl}${trimmed}`;
  }
  return trimmed;
}

function formatEmailCopyHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.65; color: ${EVENT_PASS_COLORS.promoEmailInk};">${escapeHtml(
          paragraph
        ).replace(/\n/g, '<br />')}</p>`
    )
    .join('\n');
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
  confirmationEmail?: LandingPageConfirmationEmailConfig;
}

export interface LandingConfirmationEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

function buildCustomConfirmationEmail(
  options: LandingConfirmationEmailOptions,
  config: LandingPageConfirmationEmailConfig,
  baseUrl: string
): { subject: string; html: string } {
  const safeName = options.recipientName?.trim() || 'Guest';
  const greetingPrefix = config.greetingPrefix?.trim() || 'Dear';
  const subject =
    config.subject?.trim() ||
    options.campaignTitle ||
    `${options.brandLabel || 'Event'} Confirmation`;

  const ctaImageSrc = resolveEmailAssetUrl(config.ctaImageUrl, baseUrl);
  const ctaHref = config.ctaLinkUrl?.trim();
  const ctaAlt = config.ctaImageAlt?.trim() || subject;
  const signatureImageSrc = resolveEmailAssetUrl(config.signatureImageUrl, baseUrl);
  const signatureAlt = config.signatureImageAlt?.trim() || options.brandLabel || subject;

  const ctaImgHtml = ctaImageSrc
    ? `<img src="${escapeHtml(ctaImageSrc)}" alt="${escapeHtml(
        ctaAlt
      )}" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0; border-radius: 8px;" />`
    : '';

  const ctaBlockHtml = ctaImgHtml
    ? ctaHref
      ? `<div style="margin: 20px 0;"><a href="${escapeHtml(
          ctaHref
        )}" target="_blank" rel="noopener noreferrer" style="display: block; text-decoration: none; border: 0;">${ctaImgHtml}</a></div>`
      : `<div style="margin: 20px 0;">${ctaImgHtml}</div>`
    : '';

  const signatureBlockHtml = signatureImageSrc
    ? `<div style="margin: 16px 0 0 0;"><img src="${escapeHtml(signatureImageSrc)}" alt="${escapeHtml(
        signatureAlt
      )}" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0; border-radius: 6px;" /></div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${EVENT_PASS_COLORS.text}; color: ${EVENT_PASS_COLORS.promoEmailInk}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: ${EVENT_PASS_COLORS.text}; width: 100%;">
    <tr>
      <td align="center" style="padding: 28px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 620px; background-color: ${EVENT_PASS_COLORS.white}; border: 1px solid ${EVENT_PASS_COLORS.scannerLabel}; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 28px 28px 28px 28px;">
              <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.65; color: ${EVENT_PASS_COLORS.promoEmailInk};">${escapeHtml(
                `${greetingPrefix} ${safeName},`
              )}</p>
              ${config.bodyBeforeCta ? formatEmailCopyHtml(config.bodyBeforeCta) : ''}
              ${ctaBlockHtml}
              ${config.bodyAfterCta ? formatEmailCopyHtml(config.bodyAfterCta) : ''}
              ${signatureBlockHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Builds the confirmation email subject and HTML body for either a custom promotional email
 * configuration or the standard attendee pass/wallet email.
 */
export function buildLandingConfirmationEmailContent(
  options: LandingConfirmationEmailOptions
): { subject: string; html: string } {
  const baseUrl = resolveLandingBaseUrl();
  if (options.confirmationEmail?.enabled) {
    return buildCustomConfirmationEmail(options, options.confirmationEmail, baseUrl);
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
    venue = '',
    eventDate = '',
  } = options;

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

  const subject = `Entry Confirmed: ${campaignTitle} — Your Event Pass`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${EVENT_PASS_COLORS.page}; color: ${EVENT_PASS_COLORS.text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: ${EVENT_PASS_COLORS.page}; width: 100%;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: ${EVENT_PASS_COLORS.card}; border: 1px solid ${EVENT_PASS_COLORS.borderFrame}; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px ${EVENT_PASS_COLORS.shadowEmail};">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; background: linear-gradient(135deg, ${EVENT_PASS_COLORS.gradientEnd} 0%, ${EVENT_PASS_COLORS.card} 100%); border-bottom: 1px solid ${EVENT_PASS_COLORS.borderEmail}; text-align: center;">
              <div style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: ${EVENT_PASS_COLORS.amber}; text-transform: uppercase; margin-bottom: 8px;">
                ${escapeHtml(brandLabel)}
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: ${EVENT_PASS_COLORS.white}; line-height: 1.3;">
                ${escapeHtml(campaignTitle)}
              </h1>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 17px; line-height: 1.5; color: ${EVENT_PASS_COLORS.white};">
                Hello <strong>${escapeHtml(recipientName)}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: ${EVENT_PASS_COLORS.textMuted};">
                Thank you for your submission! Your entry has been recorded. Below you will find your official attendee pass and direct links to save it to your phone for instant check-in.
              </p>

              <!-- Event Details Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px; background-color: ${EVENT_PASS_COLORS.surfaceEmail}; border: 1px solid ${EVENT_PASS_COLORS.borderEmail}; border-radius: 12px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 12px; font-weight: 700; color: ${EVENT_PASS_COLORS.accent}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                      Attendee Details
                    </div>
                    <div style="font-size: 15px; font-weight: 600; color: ${EVENT_PASS_COLORS.text}; margin-bottom: 8px;">
                      ${escapeHtml(recipientName)} (${escapeHtml(recipientEmail)})
                    </div>
                    <div style="font-size: 13px; color: ${EVENT_PASS_COLORS.textMuted};">
                      ${venue ? `<strong>Venue:</strong> ${escapeHtml(venue)}<br>` : ''}
                      ${eventDate ? `<strong>Date:</strong> ${escapeHtml(eventDate)}` : ''}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Badge Preview Image -->
              <div style="text-align: center; margin-bottom: 28px;">
                <a href="${escapeHtml(badgeImageUrl)}" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="${escapeHtml(badgeImageUrl)}" alt="Attendee Event Badge QR Code" width="280" style="width: 280px; max-width: 100%; height: auto; border-radius: 12px; border: 1px solid ${EVENT_PASS_COLORS.borderControl}; box-shadow: 0 10px 25px ${EVENT_PASS_COLORS.shadowBadge};" />
                </a>
                <div style="font-size: 12px; color: ${EVENT_PASS_COLORS.textEmailMuted}; margin-top: 8px;">
                  Tap the badge image to view or download full resolution
                </div>
              </div>

              <!-- CTA Buttons Section -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <!-- Apple Wallet Button -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="${escapeHtml(appleWalletUrl)}" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: ${EVENT_PASS_COLORS.black}; color: ${EVENT_PASS_COLORS.white}; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; border: 1px solid ${EVENT_PASS_COLORS.borderWallet};">
                       Add to Apple Wallet (.pkpass)
                    </a>
                  </td>
                </tr>

                <!-- Google Wallet Button -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="${escapeHtml(googleWalletUrl)}" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: ${EVENT_PASS_COLORS.emailWalletButton}; color: ${EVENT_PASS_COLORS.white}; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; border: 1px solid ${EVENT_PASS_COLORS.borderControl};">
                      Save to Google Wallet
                    </a>
                  </td>
                </tr>

                <!-- Save Badge PNG Button -->
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(badgeImageUrl)}" download="event-badge.svg" style="display: block; width: 100%; max-width: 320px; box-sizing: border-box; background-color: ${EVENT_PASS_COLORS.primary}; color: ${EVENT_PASS_COLORS.white}; text-align: center; padding: 14px 20px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none;">
                      Save Event Badge Image
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 32px 0 0 0; font-size: 13px; line-height: 1.6; color: ${EVENT_PASS_COLORS.textEmailMuted}; text-align: center;">
                Show your pass or badge QR code to the hostess at the entrance for direct verification and fast-track entry.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: ${EVENT_PASS_COLORS.page}; border-top: 1px solid ${EVENT_PASS_COLORS.borderEmail}; text-align: center; font-size: 12px; color: ${EVENT_PASS_COLORS.textEmailFooter};">
              © ${new Date().getFullYear()} ${escapeHtml(brandLabel)}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Builds and dispatches a responsive confirmation email via Resend.
 */
export async function sendLandingConfirmationEmail(
  options: LandingConfirmationEmailOptions
): Promise<LandingConfirmationEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[landing-confirmation-email] RESEND_API_KEY is not configured; skipping email dispatch.');
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  if (!options.recipientEmail || !options.recipientEmail.includes('@')) {
    return { sent: false, error: 'Invalid recipient email' };
  }

  const fromAddress = resolveLandingFromAddress(options.brand, options.fromEmail);
  const { subject, html } = buildLandingConfirmationEmailContent(options);

  try {
    const resend = new Resend(apiKey);
    const data = await resend.emails.send({
      from: fromAddress,
      to: options.recipientEmail,
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
    .replace(/'/g, '&#39;');
}
