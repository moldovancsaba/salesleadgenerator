import { describe, expect, it } from 'vitest';
import { patchConfirmationEmailConfig } from '../../lib/landing-page-schema';
import { buildLandingConfirmationEmailContent } from '../../lib/landing-confirmation-email';

describe('patchConfirmationEmailConfig', () => {
  it('clears CTA offer banner and shortens bodyBeforeCta while preserving bodyAfterCta and signature image', () => {
    const storedBefore = {
      enabled: true,
      subject: 'Thank you for attending The Mr Vegas Grand Slam of Darts',
      greetingPrefix: 'Dear',
      bodyBeforeCta:
        'Thank you for attending The Mr Vegas Grand Slam of Darts and taking part in the fan zone activities courtesy of the sponsor Mr Vegas who have shared their latest promotional offer here for you;',
      ctaImageUrl: '/landing/vegas/mr-vegas-offer-banner.jpg',
      ctaLinkUrl: 'https://trk.affiliates.mrvegas.com/o/lN42Wk?lpage=Y3LTFJ&site_id=7015407',
      ctaImageAlt: 'Mr Vegas — 100% up to £50 Play Now promotional offer',
      bodyAfterCta:
        'We hope you had the best time at Mr Vegas Grand Slam of Darts!\n\nStill want to be part of the action? Share your selfie from the Mr Vegas Grand Slam of Darts at fanselfie.me/mrvegas !\n\nAll the best;\nMr Vegas Grand Slam of Darts',
      signatureImageUrl: '/landing/vegas/mr-vegas-grand-slam-signature.jpg',
      signatureImageAlt: 'Mr Vegas — Grand Slam of Darts',
    };

    const updated = patchConfirmationEmailConfig(storedBefore, {
      clearCtaBanner: true,
      bodyBeforeCta:
        'Thank you for attending The Mr Vegas Grand Slam of Darts and taking part in the fan zone activities courtesy of the sponsor Mr Vegas.',
    });

    expect(updated.ctaImageUrl).toBeUndefined();
    expect(updated.ctaLinkUrl).toBeUndefined();
    expect(updated.ctaImageAlt).toBeUndefined();
    expect(updated.bodyBeforeCta).toBe(
      'Thank you for attending The Mr Vegas Grand Slam of Darts and taking part in the fan zone activities courtesy of the sponsor Mr Vegas.'
    );
    expect(updated.bodyAfterCta).toBe(storedBefore.bodyAfterCta);
    expect(updated.signatureImageUrl).toBe('/landing/vegas/mr-vegas-grand-slam-signature.jpg');

    const { html } = buildLandingConfirmationEmailContent({
      brand: 'vegas',
      recipientEmail: 'john@example.com',
      recipientName: 'John Johns',
      confirmationEmail: updated,
    });

    expect(html).toContain('Dear John Johns,');
    expect(html).toContain('courtesy of the sponsor Mr Vegas.</p>');
    expect(html).toContain('fanselfie.me/mrvegas !');
    expect(html).not.toContain('mr-vegas-offer-banner.jpg');
    expect(html).not.toContain('trk.affiliates.mrvegas.com');
    expect(html).not.toContain('who have shared their latest promotional offer');
  });
});
