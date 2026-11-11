import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCANNER_CONFIG,
  DEFAULT_VEGAS_CAMPAIGN,
  normalizeBannerAspectRatio,
  normalizeScannerConfig,
  landingPassesEnabled,
  DEFAULT_BLOCKS_CONFIG,
  toPublicLandingPage,
  toPublicScannerConfig,
} from '@/lib/landing-page-schema';
import { DEFAULT_HOSTESS_PASSWORD } from '@/lib/hostess-scan';

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

  it('shows the whole Mr Vegas Grand Slam of Darts image at the top, at its own proportions', () => {
    expect(DEFAULT_VEGAS_CAMPAIGN.heroBannerUrl).toBe('/landing/vegas/mr-vegas-grand-slam.jpg');
    expect(DEFAULT_VEGAS_CAMPAIGN.heroBannerAspectRatio).toBe('1200/1181');
  });

  it('has no PDC email tick box and no terms link', () => {
    const labels = DEFAULT_VEGAS_CAMPAIGN.fields.map((field) => field.label.toLowerCase());
    expect(labels.some((label) => label.includes('pdc'))).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.fields.some((field) => field.leadProperty === 'custom_consent_checkbox')).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.blocks?.showTermsModal).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.termsHtml).toBeUndefined();
    expect(JSON.stringify(DEFAULT_VEGAS_CAMPAIGN)).not.toContain('mrvegastcs');
  });
});

describe('normalizeBannerAspectRatio', () => {
  it('keeps a width/height pair and drops anything else', () => {
    expect(normalizeBannerAspectRatio('1200/1181')).toBe('1200/1181');
    expect(normalizeBannerAspectRatio(' 1248 / 562 ')).toBe('1248/562');
    expect(normalizeBannerAspectRatio('0/562')).toBeUndefined();
    expect(normalizeBannerAspectRatio('wide')).toBeUndefined();
    expect(normalizeBannerAspectRatio('1/1; position:fixed')).toBeUndefined();
    expect(normalizeBannerAspectRatio(undefined)).toBeUndefined();
  });
});

describe('check-in scanner config', () => {
  it('starts off, with safe defaults, for a page that never configured it', () => {
    const scanner = normalizeScannerConfig(undefined);
    expect(scanner).toMatchObject({ enabled: false, targetColumn: 'ENGAGED', createUnknownLeads: true, showAccessCodeHint: false });
    expect(scanner.accessCode).toBeUndefined();
    expect(DEFAULT_SCANNER_CONFIG.enabled).toBe(false);
  });

  it('turns on only for an explicit true and keeps a valid column', () => {
    expect(normalizeScannerConfig({ enabled: 'yes' }).enabled).toBe(false);
    expect(normalizeScannerConfig({ enabled: true, targetColumn: 'QUALIFIED' })).toMatchObject({ enabled: true, targetColumn: 'QUALIFIED' });
    expect(normalizeScannerConfig({ targetColumn: 'LOST' }).targetColumn).toBe('ENGAGED');
    expect(normalizeScannerConfig({ targetColumn: 'not-a-column' }).targetColumn).toBe('ENGAGED');
  });

  it('cleans tags, trims the code and limits text', () => {
    const scanner = normalizeScannerConfig({
      tags: ' Expo 2027 , expo-2027,, VIP!! ,' + 'x'.repeat(60),
      accessCode: '  door-code  ',
      successHeadline: 'h'.repeat(100),
      successMessage: '   ',
    });
    expect(scanner.tags.slice(0, 2)).toEqual(['expo-2027', 'vip']);
    expect(scanner.tags.every((tag) => tag.length <= 40)).toBe(true);
    expect(scanner.accessCode).toBe('door-code');
    expect(scanner.successHeadline).toHaveLength(60);
    expect(scanner.successMessage).toBe(DEFAULT_SCANNER_CONFIG.successMessage);
    expect(normalizeScannerConfig({ tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }).tags).toHaveLength(8);
  });

  it('never sends the access code to the browser unless the page shows it on the unlock screen', () => {
    const hidden = toPublicScannerConfig({ ...DEFAULT_SCANNER_CONFIG, enabled: true, accessCode: 'secret-code' });
    expect(hidden.accessCodeHint).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('secret-code');
    const shown = toPublicScannerConfig({ ...DEFAULT_SCANNER_CONFIG, enabled: true, accessCode: 'secret-code', showAccessCodeHint: true });
    expect(shown.accessCodeHint).toBe('secret-code');
  });

  it('sends a visitor no scanner settings at all, even when the page shows the code on the reader', () => {
    const page = { ...DEFAULT_VEGAS_CAMPAIGN, scanner: { ...DEFAULT_SCANNER_CONFIG, enabled: true, accessCode: 'secret-code', showAccessCodeHint: true } };
    const publicPage = toPublicLandingPage(page);
    expect(JSON.stringify(publicPage)).not.toContain('secret-code');
    expect('scanner' in publicPage).toBe(false);
    expect(publicPage.title).toBe(DEFAULT_VEGAS_CAMPAIGN.title);
  });

  it('keeps the Vegas landing page free of the hostess access code', () => {
    expect(JSON.stringify(toPublicLandingPage(DEFAULT_VEGAS_CAMPAIGN))).not.toContain(DEFAULT_HOSTESS_PASSWORD);
  });

  it('keeps the Vegas page working exactly as before', () => {
    expect(DEFAULT_VEGAS_CAMPAIGN.scanner).toMatchObject({
      enabled: true,
      targetColumn: 'ENGAGED',
      tags: ['hostess-contacted', 'card-accepted'],
      createUnknownLeads: true,
      successHeadline: 'successful',
      successMessage: 'thank you bye',
      accessCode: DEFAULT_HOSTESS_PASSWORD,
      showAccessCodeHint: true,
    });
  });
});

describe('attendee pass switch', () => {
  it('is on for a page that never set it, and off when the block switch is off', () => {
    expect(landingPassesEnabled(undefined)).toBe(true);
    expect(landingPassesEnabled(null)).toBe(true);
    expect(landingPassesEnabled({})).toBe(true);
    expect(landingPassesEnabled({ blocks: DEFAULT_BLOCKS_CONFIG })).toBe(true);
    expect(landingPassesEnabled({ blocks: { ...DEFAULT_BLOCKS_CONFIG, showDigitalPasses: false } })).toBe(false);
  });

  it('is off on the Vegas default: no QR badge, wallet, contact card, calendar entry or pass email, only lead collection', () => {
    expect(landingPassesEnabled(DEFAULT_VEGAS_CAMPAIGN)).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.blocks?.showDigitalPasses).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.blocks?.showCalendarInvite).toBe(false);
    expect(DEFAULT_VEGAS_CAMPAIGN.blocks?.showHeroBanner).toBe(true);
    expect(DEFAULT_VEGAS_CAMPAIGN.fields.length).toBeGreaterThan(0);
  });
});
