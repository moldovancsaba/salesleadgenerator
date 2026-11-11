import { describe, expect, it } from 'vitest';
import { DEFAULT_VEGAS_CAMPAIGN } from '@/lib/landing-page-schema';

describe('Vegas Grand Slam of Darts default landing page', () => {
  it('opens with the Bullseye Challenge welcome copy', () => {
    expect(DEFAULT_VEGAS_CAMPAIGN.heroHeadline).toBe('Hi Darts Fans,');
    expect(DEFAULT_VEGAS_CAMPAIGN.heroSubheadline).toBe('Welcome to The Mr Vegas Grand Slam of Darts!');
    expect(DEFAULT_VEGAS_CAMPAIGN.bodyBullets).toEqual([
      'Register your details to play The Mr Vegas Bullseye Challenge.',
      'Simply hit a Bullseye from 3 darts to win a drinks token and then go into free prize draw to win a signed dart board by the players and a bonus courtesy of Mr Vegas.',
      'Good Luck!',
    ]);
  });

  it('shows only the Mr Vegas logo at the top', () => {
    expect(DEFAULT_VEGAS_CAMPAIGN.heroBannerUrl).toBe('/landing/vegas/mr-vegas-logo.jpg');
  });

  it('has no PDC email tick box and no terms link', () => {
    const labels = DEFAULT_VEGAS_CAMPAIGN.fields.map((field) => field.label.toLowerCase());
    expect(labels.some((label) => label.includes('pdc'))).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.fields.some((field) => field.leadProperty === 'custom_consent_checkbox')).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.blocks?.showTermsModal).toBe(false);
  });
});
