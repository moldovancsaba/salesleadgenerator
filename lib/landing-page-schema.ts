import type { CurrencyCode } from '@/app/lib/brand';

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
    'Simply hit a Bullseye from 3 darts to win a drinks token and then go into free prize draw to win a signed dart board by the players and a bonus courtesy of Mr Vegas.',
    'Good Luck!',
  ],
  ctaButtonText: 'Submit Entry',
  blocks: { ...DEFAULT_BLOCKS_CONFIG, showTermsModal: false },
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
  successTitle: 'Thank You for Entering!',
  successMessage: "Ensure you're following us across Facebook, Twitter, Instagram, TikTok and YouTube to stay up to date with all of the latest PDC news and competitions.",
  viewsCount: 0,
  submissionsCount: 0,
  createdAt: new Date('2026-11-06T18:00:00Z').toISOString(),
  updatedAt: new Date().toISOString(),
};
