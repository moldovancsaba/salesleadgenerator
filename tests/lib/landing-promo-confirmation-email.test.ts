import { describe, expect, it } from 'vitest';
import { buildLandingConfirmationEmailContent } from '../../lib/landing-confirmation-email';
import {
  DEFAULT_VEGAS_CAMPAIGN,
  normalizeConfirmationEmailConfig,
  toPublicLandingPage,
} from '../../lib/landing-page-schema';
import { resolveStoredConfirmationEmail } from '../../lib/landing-page-store';

describe('Vegas promotional confirmation email', () => {
  it('configures the expected Fan Zone copy, affiliate CTA link, and public images on DEFAULT_VEGAS_CAMPAIGN', () => {
    const cfg = DEFAULT_VEGAS_CAMPAIGN.confirmationEmail;
    expect(cfg?.enabled).toBe(true);
    expect(cfg?.ctaLinkUrl).toBe('https://trk.affiliates.mrvegas.com/o/lN42Wk?lpage=Y3LTFJ&site_id=7015407');
    expect(cfg?.ctaImageUrl).toBe('/landing/vegas/mr-vegas-offer-banner.jpg');
    expect(cfg?.signatureImageUrl).toBe('/landing/vegas/mr-vegas-grand-slam-signature.jpg');
  });

  it('renders Dear ${user_name}, promo copy, clickable CTA banner, closing lines, and signature without wallet/pass links', () => {
    const { subject, html } = buildLandingConfirmationEmailContent({
      brand: 'vegas',
      brandLabel: 'Mr Vegas',
      campaign: 'grand-slam-of-darts',
      campaignTitle: 'Mr Vegas Grand Slam of Darts',
      recipientEmail: 'fan@example.com',
      recipientName: 'Csaba Moldovan',
      confirmationEmail: DEFAULT_VEGAS_CAMPAIGN.confirmationEmail,
    });

    expect(subject).toBe('Thank you for attending The Mr Vegas Grand Slam of Darts');
    expect(html).toContain('Dear Csaba Moldovan,');
    expect(html).toContain(
      'Thank you for attending The Mr Vegas Grand Slam of Darts and taking part in the fan zone activities courtesy of the sponsor Mr Vegas who have shared their latest promotional offer here for you;'
    );
    expect(html).toContain(
      'href="https://trk.affiliates.mrvegas.com/o/lN42Wk?lpage=Y3LTFJ&amp;site_id=7015407"'
    );
    expect(html).toContain('https://sales.haho.ai/landing/vegas/mr-vegas-offer-banner.jpg');
    expect(html).toContain('We hope you had the best time at Mr Vegas Grand Slam of Darts!');
    expect(html).toContain('All the best;<br />Mr Vegas Grand Slam of Darts');
    expect(html).toContain('https://sales.haho.ai/landing/vegas/mr-vegas-grand-slam-signature.jpg');
    expect(html).not.toContain('/api/wallet/pass');
    expect(html).not.toContain('/api/badge');
    expect(html).not.toContain('Google Wallet');
    expect(html).not.toContain('Apple Wallet');
  });

  it('escapes HTML characters in recipient name and custom copy', () => {
    const { html } = buildLandingConfirmationEmailContent({
      brand: 'vegas',
      recipientEmail: 'xss@example.com',
      recipientName: '<script>alert(1)</script>',
      confirmationEmail: {
        enabled: true,
        bodyBeforeCta: 'Hello <img src=x onerror=alert(1)>',
      },
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sanitizes unsafe URLs in normalizeConfirmationEmailConfig and strips confirmationEmail in toPublicLandingPage', () => {
    const normalized = normalizeConfirmationEmailConfig({
      enabled: true,
      ctaImageUrl: 'javascript:alert(1)',
      ctaLinkUrl: 'data:text/html,<script>alert(1)</script>',
      signatureImageUrl: '/landing/vegas/mr-vegas-grand-slam-signature.jpg',
    });

    expect(normalized?.enabled).toBe(true);
    expect(normalized?.ctaImageUrl).toBeUndefined();
    expect(normalized?.ctaLinkUrl).toBeUndefined();
    expect(normalized?.signatureImageUrl).toBe('/landing/vegas/mr-vegas-grand-slam-signature.jpg');

    const publicRecord = toPublicLandingPage(DEFAULT_VEGAS_CAMPAIGN);
    expect('confirmationEmail' in publicRecord).toBe(false);
    expect('scanner' in publicRecord).toBe(false);
  });

  it('falls back to DEFAULT_VEGAS_CAMPAIGN.confirmationEmail for legacy Vegas DB docs without confirmationEmail, while honoring explicit disable', () => {
    expect(
      resolveStoredConfirmationEmail({ brand: 'vegas', slug: 'grand-slam-of-darts', confirmationEmail: undefined })
    ).toEqual(DEFAULT_VEGAS_CAMPAIGN.confirmationEmail);

    expect(
      resolveStoredConfirmationEmail({
        brand: 'vegas',
        slug: 'grand-slam-of-darts',
        confirmationEmail: { enabled: false },
      })
    ).toEqual({ enabled: false });

    expect(
      resolveStoredConfirmationEmail({ brand: 'other', slug: 'vip-pass', confirmationEmail: undefined })
    ).toBeUndefined();
  });
});
