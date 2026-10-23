import { EMAIL_RE } from './validate-lead';
import { isValidIsoCountry } from './iso-country-codes';
import { computeIceScore, buildScoreProfile } from './score-profile';

export type InboundFormInput = {
  entityName?: unknown;
  websiteUrl?: unknown;
  country?: unknown;
  contactName?: unknown;
  contactTitle?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  sportOrSector?: unknown;
  organizationSize?: unknown;
  message?: unknown;
  // Honeypot anti-spam field — must remain empty for legitimate human submissions
  companyFaxHoneypot?: unknown;
};

export type ValidatedInboundFormSubmission = {
  entityName: string;
  websiteUrl: string;
  country: string;
  region: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  sportOrSector: string;
  organizationSize: 'Small' | 'Medium' | 'Large' | 'Enterprise' | '';
  message: string;
  honeypotTriggered: boolean;
};

const CCTLD_TO_COUNTRY: Record<string, string> = {
  uk: 'GB',
  gb: 'GB',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  nl: 'NL',
  be: 'BE',
  ch: 'CH',
  at: 'AT',
  hu: 'HU',
  pl: 'PL',
  cz: 'CZ',
  sk: 'SK',
  ro: 'RO',
  pt: 'PT',
  se: 'SE',
  no: 'NO',
  dk: 'DK',
  fi: 'FI',
  ie: 'IE',
  us: 'US',
  ca: 'CA',
  au: 'AU',
  nz: 'NZ',
  ae: 'AE',
  sa: 'SA',
  qa: 'QA',
  br: 'BR',
  mx: 'MX',
  ar: 'AR',
  jp: 'JP',
  kr: 'KR',
  sg: 'SG',
};

const COUNTRY_TO_REGION: Record<string, string> = {
  US: 'US',
  CA: 'NA',
  MX: 'LATAM',
  BR: 'LATAM',
  AR: 'LATAM',
  HU: 'CEE',
  PL: 'CEE',
  CZ: 'CEE',
  SK: 'CEE',
  RO: 'CEE',
  DE: 'DACH',
  AT: 'DACH',
  CH: 'DACH',
  GB: 'UKI',
  IE: 'UKI',
  AE: 'MEA',
  SA: 'MEA',
  QA: 'MEA',
  AU: 'APAC',
  NZ: 'APAC',
  JP: 'APAC',
  KR: 'APAC',
  SG: 'APAC',
};

const VALID_SIZES = new Set(['Small', 'Medium', 'Large', 'Enterprise']);

export function normalizeWebsiteUrl(rawUrl: string, fallbackEmail?: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
  if (fallbackEmail && EMAIL_RE.test(fallbackEmail)) {
    const domain = fallbackEmail.split('@')[1]?.trim().toLowerCase();
    if (domain && !['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'].includes(domain)) {
      return `https://${domain}`;
    }
  }
  return 'https://inbound-lead.local';
}

export function inferIsoCountryFromUrlOrEmail(websiteUrl: string, email: string, explicitCountry?: string): string {
  if (explicitCountry && typeof explicitCountry === 'string') {
    const upper = explicitCountry.trim().toUpperCase();
    if (isValidIsoCountry(upper)) return upper;
  }

  // Try ccTLD from website URL
  try {
    const host = new URL(websiteUrl).hostname.toLowerCase();
    const parts = host.split('.');
    const tld = parts[parts.length - 1];
    if (tld && CCTLD_TO_COUNTRY[tld]) return CCTLD_TO_COUNTRY[tld];
  } catch {
    // ignore URL parse error
  }

  // Try ccTLD from email domain
  const emailParts = email.toLowerCase().split('@');
  if (emailParts.length === 2) {
    const domainParts = emailParts[1].split('.');
    const tld = domainParts[domainParts.length - 1];
    if (tld && CCTLD_TO_COUNTRY[tld]) return CCTLD_TO_COUNTRY[tld];
  }

  return 'US';
}

export function inferRegionFromCountry(country: string): string {
  const upper = country.trim().toUpperCase();
  return COUNTRY_TO_REGION[upper] || 'EMEA';
}

export function validateInboundFormSubmission(
  input: InboundFormInput
): { ok: true; data: ValidatedInboundFormSubmission } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid form submission' };
  }

  const honeypot = typeof input.companyFaxHoneypot === 'string' ? input.companyFaxHoneypot.trim() : '';
  const entityName = typeof input.entityName === 'string' ? input.entityName.trim().slice(0, 200) : '';
  const contactName = typeof input.contactName === 'string' ? input.contactName.trim().slice(0, 140) : '';
  const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim().toLowerCase().slice(0, 180) : '';
  const contactTitle = typeof input.contactTitle === 'string' ? input.contactTitle.trim().slice(0, 140) : '';
  const contactPhone = typeof input.contactPhone === 'string' ? input.contactPhone.trim().slice(0, 60) : '';
  const rawWebsite = typeof input.websiteUrl === 'string' ? input.websiteUrl.trim().slice(0, 300) : '';
  const rawCountry = typeof input.country === 'string' ? input.country.trim() : '';
  const sportOrSector = typeof input.sportOrSector === 'string' ? input.sportOrSector.trim().slice(0, 120) : '';
  const rawSize = typeof input.organizationSize === 'string' ? input.organizationSize.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2000) : '';

  if (!entityName) {
    return { ok: false, error: 'Organization or club name is required' };
  }
  if (!contactName) {
    return { ok: false, error: 'Your full name is required' };
  }
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return { ok: false, error: 'A valid business email address is required' };
  }

  const websiteUrl = normalizeWebsiteUrl(rawWebsite, contactEmail);
  const country = inferIsoCountryFromUrlOrEmail(websiteUrl, contactEmail, rawCountry);
  const region = inferRegionFromCountry(country);
  const organizationSize = VALID_SIZES.has(rawSize)
    ? (rawSize as ValidatedInboundFormSubmission['organizationSize'])
    : '';

  return {
    ok: true,
    data: {
      entityName,
      websiteUrl,
      country,
      region,
      contactName,
      contactTitle: contactTitle || 'Inbound Inquiry Contact',
      contactEmail,
      contactPhone,
      sportOrSector,
      organizationSize,
      message,
      honeypotTriggered: honeypot.length > 0,
    },
  };
}

export function buildInboundLeadRecord(params: {
  submission: ValidatedInboundFormSubmission;
  tenantId: string;
  fingerprint: string;
  sortOrder: number;
  ticketSizeEstimate?: any;
  assignedTo?: string;
  now?: Date;
}) {
  const { submission, tenantId, fingerprint, sortOrder, ticketSizeEstimate, assignedTo } = params;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();

  // Inbound inquiries express explicit buyer intent -> high confidence & ease
  const impact = submission.organizationSize === 'Enterprise' ? 9
    : submission.organizationSize === 'Large' ? 8
    : submission.organizationSize === 'Medium' ? 7
    : 6;
  const confidence = 8;
  const ease = submission.contactPhone ? 8 : 7;
  const iceScore = computeIceScore(impact, confidence, ease);
  const scoreProfile = buildScoreProfile(impact, confidence, ease);

  const contact = {
    name: submission.contactName,
    title: submission.contactTitle || 'Inbound Inquiry Contact',
    email: submission.contactEmail,
    ...(submission.contactPhone ? { phone: submission.contactPhone } : {}),
    isDecisionMaker: true,
    buyingRole: 'champion' as const,
    lastVerifiedAt: nowIso,
  };

  return {
    id: now.getTime(),
    region: submission.region,
    country: submission.country,
    entity_name: submission.entityName,
    url: submission.websiteUrl,
    contacts: [contact],
    contactEmails: [submission.contactEmail],
    address: '',
    general_contact: submission.contactEmail,
    size: submission.organizationSize,
    industry: submission.sportOrSector || 'Inbound Web Inquiry',
    sport_or_sector: submission.sportOrSector || '',
    level_league: '',
    pros: submission.message ? [`Inbound inquiry: ${submission.message.slice(0, 240)}`] : ['Inbound web inquiry'],
    cons: [],
    value_proposition: submission.message || `Inbound web form inquiry from ${submission.contactName} (${submission.entityName}).`,
    recommended_tier: '',
    estimated_participants: 0,
    estimated_annual_revenue_usd: 0,
    revenue_model: '',
    product_fit_notes: submission.message || '',
    pricingByCompany: {},
    ...(ticketSizeEstimate ? { ticketSizeEstimate } : {}),
    ...(assignedTo ? { assignedTo } : {}),
    status: 'new',
    notes: submission.message
      ? `[Inbound Form ${nowIso.slice(0, 10)}] ${submission.contactName} (${submission.contactEmail}): ${submission.message}`
      : `[Inbound Form ${nowIso.slice(0, 10)}] Submitted by ${submission.contactName} (${submission.contactEmail}).`,
    tags: [],
    deals: [],
    checklist: [],
    source: 'inbound',
    fieldVerifications: [],
    kanbanColumn: 'DISCOVERED',
    sortOrder,
    fingerprint,
    tenantId,
    ice: { impact, confidence, ease },
    iceScore,
    scoreProfile,
    normalizationWarnings: [],
    feedbackScore: 0,
    declineCount: 0,
    acceptanceCount: 0,
    nextActionDueAt: nowIso,
    nextActionNote: `Respond to inbound inquiry from ${submission.contactName}`,
    createdAt: now,
    updatedAt: now,
  };
}
