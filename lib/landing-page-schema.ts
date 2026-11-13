/**
 * Landing page record and the settings that make a page campaign-specific: content, form fields, block toggles,
 * event details (printed on the attendee pass) and the check-in scanner. Shared code reads these fields and names
 * no campaign. `toPublicLandingPage` and `toPublicScannerConfig` are the only forms a browser may receive: the
 * scanner's access code never leaves the server except when a page opts in to showing it on the reader.
 */
import type { CurrencyCode } from '@/app/lib/brand';
import { DEFAULT_HOSTESS_PASSWORD } from './hostess-scan';

export type LeadPropertyKey =
  | 'entity_name'
  | 'contact_first_name'
  | 'contact_last_name'
  | 'contact_email'
  | 'contact_phone'
  | 'contact_title'
  | 'country'
  | 'post_code'
  | 'city'
  | 'address'
  | 'url'
  | 'size'
  | 'sport_or_sector'
  | 'industry'
  | 'message'
  | 'date_of_birth'
  | 'custom_consent_checkbox'
  | 'custom_radio_choice';

export interface LandingFormFieldConfig {
  id: string;
  leadProperty: LeadPropertyKey;
  label: string;
  placeholder?: string;
  type: 'text' | 'email' | 'tel' | 'url' | 'date' | 'select' | 'textarea' | 'checkbox' | 'radio';
  required: boolean;
  options?: string[]; // for select/radio
  description?: string;
  defaultValue?: string | boolean;
}

export interface LandingPageDesignConfig {
  themePreset: 'dark_emerald' | 'gold_luxury' | 'indigo_tech' | 'slate_minimal' | 'crimson_sport';
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  cardBackgroundColor: string;
  textColor: string;
}

export interface LandingPageBlocksConfig {
  showHeroBanner: boolean;
  showHeroCopy: boolean;
  showBullets: boolean;
  showDigitalPasses: boolean; // Apple Wallet, Google Wallet, contact card & badge downloads
  showCalendarInvite: boolean; // .ics calendar add
  showTermsModal: boolean;
  showFooterDisclaimer: boolean;
}

/** A banner proportion such as `1200/1181`; anything else is dropped so a bad value cannot break the layout. */
export function normalizeBannerAspectRatio(value: unknown): string | undefined {
  const match = typeof value === 'string' ? value.trim().match(/^(\d{1,5})\s*\/\s*(\d{1,5})$/) : null;
  if (!match || Number(match[1]) === 0 || Number(match[2]) === 0) return undefined;
  return `${Number(match[1])}/${Number(match[2])}`;
}

export const DEFAULT_BLOCKS_CONFIG: LandingPageBlocksConfig = {
  showHeroBanner: true,
  showHeroCopy: true,
  showBullets: true,
  showDigitalPasses: true,
  showCalendarInvite: true,
  showTermsModal: true,
  showFooterDisclaimer: true,
};

/** What the attendee pass, calendar entry and confirmation email say about the event. */
export interface LandingPageEventDetails {
  name?: string;
  venue?: string;
  date?: string;
}

/** Event details reduced to short plain text; empty values are dropped so the pass falls back to the page title. */
export function normalizeEventDetails(value: unknown): LandingPageEventDetails | undefined {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (input: unknown, max: number) => (typeof input === 'string' ? input.trim().slice(0, max) : '');
  const name = pick(raw.name, 120);
  const venue = pick(raw.venue, 160);
  const date = pick(raw.date, 80);
  if (!name && !venue && !date) return undefined;
  return { ...(name ? { name } : {}), ...(venue ? { venue } : {}), ...(date ? { date } : {}) };
}

/**
 * Whether a page hands visitors an attendee pass (badge with QR code, wallet, contact card, calendar) and sends the
 * confirmation email that carries it. The `showDigitalPasses` block switch decides; a page that never set it keeps the pass.
 */
export function landingPassesEnabled(page: { blocks?: Partial<LandingPageBlocksConfig> } | null | undefined): boolean {
  return page?.blocks?.showDigitalPasses !== false;
}

/** Columns a check-in scan may move a lead to, in pipeline order. */
export const SCANNER_TARGET_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON'] as const;
export type ScannerTargetColumn = (typeof SCANNER_TARGET_COLUMNS)[number];

/**
 * Check-in scanner of a landing page. Any landing page can turn it on: the page's attendee pass carries a QR code,
 * and the scanner at `/landing/[brand]/[campaign]/qrreader` moves the matching lead to `targetColumn`.
 */
export interface LandingPageScannerConfig {
  enabled: boolean;
  /** The column a scan moves the lead to. A lead already further along the pipeline stays where it is. */
  targetColumn: ScannerTargetColumn;
  /** Tags added to the lead on check-in. */
  tags: string[];
  /** A scan that matches no lead creates one (a walk-in) in `targetColumn`. */
  createUnknownLeads: boolean;
  /** Headline and line shown on the green result screen. */
  successHeadline: string;
  successMessage: string;
  /** What staff type to unlock the scanner. Server only: never sent to the browser. */
  accessCode?: string;
  /** Show the access code on the unlock screen. Anyone who opens the reader page can then read it. */
  showAccessCodeHint: boolean;
}

export const DEFAULT_SCANNER_CONFIG: LandingPageScannerConfig = {
  enabled: false,
  targetColumn: 'ENGAGED',
  tags: ['checked-in'],
  createUnknownLeads: true,
  successHeadline: 'Checked in',
  successMessage: 'Welcome',
  showAccessCodeHint: false,
};

function cleanText(value: unknown, fallback: string, max: number): string {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || fallback;
}

/** A stored or submitted scanner config, reduced to values the scanner can trust. */
export function normalizeScannerConfig(value: unknown): LandingPageScannerConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const column = SCANNER_TARGET_COLUMNS.find((c) => c === raw.targetColumn) ?? DEFAULT_SCANNER_CONFIG.targetColumn;
  const rawTags = Array.isArray(raw.tags) ? raw.tags : typeof raw.tags === 'string' ? raw.tags.split(',') : DEFAULT_SCANNER_CONFIG.tags;
  const tags = Array.from(
    new Set(
      rawTags
        .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40) : ''))
        .filter(Boolean)
    )
  ).slice(0, 8);
  const accessCode = typeof raw.accessCode === 'string' ? raw.accessCode.trim().slice(0, 80) : '';
  return {
    enabled: raw.enabled === true,
    targetColumn: column,
    tags,
    createUnknownLeads: raw.createUnknownLeads !== false,
    successHeadline: cleanText(raw.successHeadline, DEFAULT_SCANNER_CONFIG.successHeadline, 60),
    successMessage: cleanText(raw.successMessage, DEFAULT_SCANNER_CONFIG.successMessage, 80),
    ...(accessCode ? { accessCode } : {}),
    showAccessCodeHint: raw.showAccessCodeHint === true,
  };
}

/** What the browser may know about a page's scanner. The access code is included only when the page opts in to showing it. */
export interface PublicScannerConfig {
  enabled: boolean;
  targetColumn: ScannerTargetColumn;
  successHeadline: string;
  successMessage: string;
  accessCodeHint: string | null;
}

/** The landing page as a visitor's browser receives it: no scanner settings at all. */
export type PublicLandingPageRecord = Omit<LandingPageRecord, 'scanner'>;

export function toPublicScannerConfig(config: LandingPageScannerConfig | undefined): PublicScannerConfig {
  const scanner = normalizeScannerConfig(config);
  return {
    enabled: scanner.enabled,
    targetColumn: scanner.targetColumn,
    successHeadline: scanner.successHeadline,
    successMessage: scanner.successMessage,
    accessCodeHint: scanner.showAccessCodeHint && scanner.accessCode ? scanner.accessCode : null,
  };
}

/** The page record as a visitor's browser may see it: the scanner settings, including the access code, are removed. */
export function toPublicLandingPage(page: LandingPageRecord): PublicLandingPageRecord {
  const { scanner: _scanner, ...rest } = page;
  return rest;
}

export interface LandingPageRecord {
  id?: string;
  _id?: string;
  brand: string;
  tenantId: string;
  slug: string; // e.g. "grand-slam-of-darts" or "lead-magnet-2026"
  title: string;
  description?: string;
  published: boolean;
  // Modular blocks configuration (enable/show or disable/hide)
  blocks?: LandingPageBlocksConfig;
  // Event details printed on the pass, calendar entry and confirmation email
  event?: LandingPageEventDetails;
  // Check-in scanner (QR reader for staff)
  scanner?: LandingPageScannerConfig;
  // Hero section
  heroBannerUrl?: string;
  /** Width over height of the banner image, so the whole image is shown. Defaults to the 1248/562 email banner. */
  heroBannerAspectRatio?: string;
  heroHeadline?: string;
  heroSubheadline?: string;
  bodyBullets?: string[];
  ctaButtonText: string;
  // Form configuration
  fields: LandingFormFieldConfig[];
  // Design settings
  design: LandingPageDesignConfig;
  // Terms & Legal
  termsHtml?: string;
  footerDisclaimer?: string;
  // Success state
  successTitle?: string;
  successMessage?: string;
  // Metrics
  viewsCount?: number;
  submissionsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export const SLG_LEAD_PROPERTIES: Array<{
  key: LeadPropertyKey;
  label: string;
  category: 'Contact' | 'Organization' | 'Location' | 'Demographic & Extra';
  defaultType: LandingFormFieldConfig['type'];
  description: string;
}> = [
  { key: 'contact_first_name', label: 'First Name', category: 'Contact', defaultType: 'text', description: 'Stored in contacts[0].name (first part)' },
  { key: 'contact_last_name', label: 'Last Name', category: 'Contact', defaultType: 'text', description: 'Stored in contacts[0].name (last part)' },
  { key: 'contact_email', label: 'Contact Email', category: 'Contact', defaultType: 'email', description: 'Authoritative email for contacts[0].email and contactEmails' },
  { key: 'contact_phone', label: 'Phone Number', category: 'Contact', defaultType: 'tel', description: 'Stored in contacts[0].phone' },
  { key: 'contact_title', label: 'Job Title / Role', category: 'Contact', defaultType: 'text', description: 'Stored in contacts[0].title' },
  { key: 'entity_name', label: 'Organization / Entity Name', category: 'Organization', defaultType: 'text', description: 'Primary entity name on the Lead record' },
  { key: 'url', label: 'Website URL', category: 'Organization', defaultType: 'url', description: 'Stored in lead.url' },
  { key: 'size', label: 'Organization Size', category: 'Organization', defaultType: 'select', description: 'Stored in lead.size (Small, Medium, Large, Enterprise)' },
  { key: 'sport_or_sector', label: 'Sport or Sector', category: 'Organization', defaultType: 'text', description: 'Stored in lead.sport_or_sector' },
  { key: 'industry', label: 'Industry', category: 'Organization', defaultType: 'text', description: 'Stored in lead.industry' },
  { key: 'country', label: 'Country', category: 'Location', defaultType: 'select', description: 'Stored in lead.country (ISO-2 code)' },
  { key: 'post_code', label: 'Post Code / ZIP', category: 'Location', defaultType: 'text', description: 'Stored in lead.address' },
  { key: 'city', label: 'City', category: 'Location', defaultType: 'text', description: 'Stored in lead.cityName' },
  { key: 'address', label: 'Street Address', category: 'Location', defaultType: 'text', description: 'Stored in lead.address' },
  { key: 'date_of_birth', label: 'Date of Birth', category: 'Demographic & Extra', defaultType: 'date', description: 'Recorded in lead.extraNotes and metadata' },
  { key: 'message', label: 'Message / Inquiry Details', category: 'Demographic & Extra', defaultType: 'textarea', description: 'Recorded in lead.value_proposition and activityLog note' },
  { key: 'custom_consent_checkbox', label: 'Consent Checkbox (Opt-in)', category: 'Demographic & Extra', defaultType: 'checkbox', description: 'Permission consent recorded in lead notes' },
  { key: 'custom_radio_choice', label: 'Marketing Radio Choice', category: 'Demographic & Extra', defaultType: 'radio', description: 'Preference option recorded in lead notes' },
];

export const THEME_PRESETS: Record<LandingPageDesignConfig['themePreset'], LandingPageDesignConfig> = {
  dark_emerald: {
    themePreset: 'dark_emerald',
    primaryColor: '#00a862',
    accentColor: '#fbbf24',
    backgroundColor: '#07080a',
    cardBackgroundColor: '#0f1117',
    textColor: '#f3f4f6',
  },
  gold_luxury: {
    themePreset: 'gold_luxury',
    primaryColor: '#f59e0b',
    accentColor: '#10b981',
    backgroundColor: '#0c0a09',
    cardBackgroundColor: '#1c1917',
    textColor: '#fafaf9',
  },
  indigo_tech: {
    themePreset: 'indigo_tech',
    primaryColor: '#6366f1',
    accentColor: '#38bdf8',
    backgroundColor: '#0b0f19',
    cardBackgroundColor: '#111827',
    textColor: '#f9fafb',
  },
  slate_minimal: {
    themePreset: 'slate_minimal',
    primaryColor: '#3b82f6',
    accentColor: '#60a5fa',
    backgroundColor: '#090d16',
    cardBackgroundColor: '#151c2c',
    textColor: '#f1f5f9',
  },
  crimson_sport: {
    themePreset: 'crimson_sport',
    primaryColor: '#dc2626',
    accentColor: '#f59e0b',
    backgroundColor: '#0a0505',
    cardBackgroundColor: '#180c0c',
    textColor: '#fef2f2',
  },
};

export const DEFAULT_VEGAS_CAMPAIGN: LandingPageRecord = {
  brand: 'vegas',
  tenantId: 'default',
  slug: 'grand-slam-of-darts',
  title: 'Win Tickets to the Mr Vegas Grand Slam of Darts',
  description: 'Enter the official Mr Vegas Grand Slam of Darts ticket giveaway. Top players battle it out at WV Active Aldersley for the Eric Bristow Trophy.',
  published: true,
  heroBannerUrl: '/landing/vegas/mr-vegas-grand-slam.jpg',
  heroBannerAspectRatio: '1200/1181',
  heroHeadline: 'Hi Darts Fans,',
  heroSubheadline: 'Welcome to The Mr Vegas Grand Slam of Darts!',
  bodyBullets: [
    'Register your details to play The Mr Vegas Bullseye Challenge.',
    'Simply hit a Bullseye from 3 darts to win a drinks token from one of Mr Vegas Team managing the promotion fan zone game and then everyone who plays will be automatically entered into a free prize draw to win a signed dart board by the players and a bonus courtesy of Mr Vegas.',
    'You must be 18 and over to participate in the Mr Vegas Bullseye Challenge.',
    'Good Luck!',
  ],
  ctaButtonText: 'Submit Entry',
  blocks: { ...DEFAULT_BLOCKS_CONFIG, showTermsModal: false, showDigitalPasses: false, showCalendarInvite: false },
  event: {
    name: 'Mr Vegas Grand Slam of Darts',
    venue: 'WV Active Aldersley, Wolverhampton',
    date: 'November 2026',
  },
  scanner: {
    enabled: true,
    targetColumn: 'ENGAGED',
    tags: ['hostess-contacted', 'card-accepted'],
    createUnknownLeads: true,
    successHeadline: 'successful',
    successMessage: 'thank you bye',
    accessCode: DEFAULT_HOSTESS_PASSWORD,
    showAccessCodeHint: true,
  },
  design: THEME_PRESETS.dark_emerald,
  fields: [
    {
      id: 'f_first_name',
      leadProperty: 'contact_first_name',
      label: 'First Name',
      placeholder: 'e.g. John',
      type: 'text',
      required: true,
    },
    {
      id: 'f_last_name',
      leadProperty: 'contact_last_name',
      label: 'Last Name',
      placeholder: 'e.g. Smith',
      type: 'text',
      required: false,
    },
    {
      id: 'f_country',
      leadProperty: 'country',
      label: 'Country',
      type: 'select',
      required: true,
    },
    {
      id: 'f_postcode',
      leadProperty: 'post_code',
      label: 'Post Code',
      placeholder: 'e.g. WV6 9NW',
      type: 'text',
      required: true,
    },
    {
      id: 'f_dob',
      leadProperty: 'date_of_birth',
      label: 'Date of Birth (please select from the calendar)',
      description: 'YYYY-MM-DD (18+ only)',
      placeholder: 'YYYY-MM-DD',
      type: 'date',
      required: true,
    },
    {
      id: 'f_phone',
      leadProperty: 'contact_phone',
      label: 'Phone Number',
      placeholder: '+44 7123 456789',
      type: 'tel',
      required: false,
    },
    {
      id: 'f_email',
      leadProperty: 'contact_email',
      label: 'Contact Email',
      placeholder: 'john.smith@example.com',
      type: 'email',
      required: true,
    },
    {
      id: 'f_vegas_consent',
      leadProperty: 'custom_radio_choice',
      label: 'Can Mr Vegas contact you with marketing and promotional offers?',
      type: 'radio',
      options: ['Yes', 'No'],
      required: false,
      defaultValue: 'no',
    },
  ],
  footerDisclaimer: 'By entering you are agreeing to share your personal data with Mr Vegas. You are agreeing to receive marketing communications. Data will be processed in accordance with its privacy policy.',
  successTitle: 'Thank you for entering!',
  successMessage: 'Have a brilliant night at The Mr Vegas Grand Slam of Darts and look out for an email from us very soon.',
  viewsCount: 0,
  submissionsCount: 0,
  createdAt: new Date('2026-11-06T18:00:00Z').toISOString(),
  updatedAt: new Date().toISOString(),
};
