import { EMAIL_RE } from './validate-lead';
import { isValidIsoCountry } from './iso-country-codes';
import { computeIceScore, buildScoreProfile } from './score-profile';

export type InboundFormInput = {
  entityName?: unknown;
  websiteUrl?: unknown;
  country?: unknown;
  contactName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  contactTitle?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  postCode?: unknown;
  city?: unknown;
  address?: unknown;
  dateOfBirth?: unknown;
  consentPdc?: unknown;
  consentMrVegas?: unknown;
  sportOrSector?: unknown;
  industry?: unknown;
  organizationSize?: unknown;
  message?: unknown;
  campaign?: unknown;
  // Dynamic mapped fields dictionary for landing page builder customization
  dynamicFields?: Record<string, unknown>;
  // Honeypot anti-spam field — must remain empty for legitimate human submissions
  companyFaxHoneypot?: unknown;
};

export type ValidatedInboundFormSubmission = {
  entityName: string;
  websiteUrl: string;
  country: string;
  region: string;
  contactName: string;
  firstName?: string;
  lastName?: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  postCode?: string;
  city?: string;
  address?: string;
  dateOfBirth?: string;
  consentPdc?: boolean;
  consentMrVegas?: boolean;
  sportOrSector: string;
  industry?: string;
  organizationSize: 'Small' | 'Medium' | 'Large' | 'Enterprise' | '';
  message: string;
  campaign?: string;
  dynamicFields?: Record<string, unknown>;
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
  const rawFirstName = typeof input.firstName === 'string' ? input.firstName.trim().slice(0, 70) : '';
  const rawLastName = typeof input.lastName === 'string' ? input.lastName.trim().slice(0, 70) : '';
  let contactName = typeof input.contactName === 'string' ? input.contactName.trim().slice(0, 140) : '';
  if (!contactName && (rawFirstName || rawLastName)) {
    contactName = `${rawFirstName} ${rawLastName}`.trim();
  }

  let entityName = typeof input.entityName === 'string' ? input.entityName.trim().slice(0, 200) : '';
  // Fall back to contactName only if raw entityName was completely undefined/omitted (e.g. from individual contest landing page)
  if (input.entityName === undefined && contactName) {
    entityName = `${contactName} (Individual)`;
  }

  const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim().toLowerCase().slice(0, 180) : '';
  const contactTitle = typeof input.contactTitle === 'string' ? input.contactTitle.trim().slice(0, 140) : '';
  const contactPhone = typeof input.contactPhone === 'string' ? input.contactPhone.trim().slice(0, 60) : '';
  const rawWebsite = typeof input.websiteUrl === 'string' ? input.websiteUrl.trim().slice(0, 300) : '';
  const rawCountry = typeof input.country === 'string' ? input.country.trim() : '';
  const postCode = typeof input.postCode === 'string' ? input.postCode.trim().slice(0, 30) : '';
  const city = typeof input.city === 'string' ? input.city.trim().slice(0, 80) : '';
  const address = typeof input.address === 'string' ? input.address.trim().slice(0, 200) : '';
  const dateOfBirth = typeof input.dateOfBirth === 'string' ? input.dateOfBirth.trim().slice(0, 30) : '';
  const consentPdc = input.consentPdc === undefined
    ? undefined
    : input.consentPdc === true || input.consentPdc === 'true' || input.consentPdc === '1' || input.consentPdc === 1;
  const consentMrVegas = input.consentMrVegas === true || input.consentMrVegas === 'true' || input.consentMrVegas === '1' || input.consentMrVegas === 1;
  const sportOrSector = typeof input.sportOrSector === 'string' ? input.sportOrSector.trim().slice(0, 120) : '';
  const industry = typeof input.industry === 'string' ? input.industry.trim().slice(0, 120) : '';
  const rawSize = typeof input.organizationSize === 'string' ? input.organizationSize.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2000) : '';
  const campaign = typeof input.campaign === 'string' ? input.campaign.trim().slice(0, 100) : '';
  const dynamicFields = input.dynamicFields && typeof input.dynamicFields === 'object' ? (input.dynamicFields as Record<string, unknown>) : undefined;

  if (!entityName) {
    return { ok: false, error: 'Organization or contact name is required' };
  }
  if (!contactName) {
    return { ok: false, error: 'Your full name is required' };
  }
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
    return { ok: false, error: 'A valid email address is required' };
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
      ...(rawFirstName ? { firstName: rawFirstName } : {}),
      ...(rawLastName ? { lastName: rawLastName } : {}),
      contactTitle: contactTitle || 'Lead Contact',
      contactEmail,
      contactPhone,
      ...(postCode ? { postCode } : {}),
      ...(city ? { city } : {}),
      ...(address ? { address } : {}),
      ...(dateOfBirth ? { dateOfBirth } : {}),
      ...(consentPdc !== undefined ? { consentPdc } : {}),
      ...(consentMrVegas !== undefined ? { consentMrVegas } : {}),
      sportOrSector,
      ...(industry ? { industry } : {}),
      organizationSize,
      message,
      ...(campaign ? { campaign } : {}),
      ...(dynamicFields ? { dynamicFields } : {}),
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
    title: submission.contactTitle || 'Lead Contact',
    email: submission.contactEmail,
    ...(submission.contactPhone ? { phone: submission.contactPhone } : {}),
    isDecisionMaker: true,
    buyingRole: 'champion' as const,
    lastVerifiedAt: nowIso,
  };

  const extraNotes: string[] = [];
  if (submission.postCode) extraNotes.push(`Post Code: ${submission.postCode}`);
  if (submission.city) extraNotes.push(`City: ${submission.city}`);
  if (submission.address) extraNotes.push(`Address: ${submission.address}`);
  if (submission.dateOfBirth) extraNotes.push(`DOB: ${submission.dateOfBirth}`);
  if (submission.consentPdc !== undefined) extraNotes.push(`PDC Email Opt-in: ${submission.consentPdc ? 'Yes' : 'No'}`);
  if (submission.consentMrVegas !== undefined) extraNotes.push(`Mr Vegas Promo Opt-in: ${submission.consentMrVegas ? 'Yes' : 'No'}`);
  if (submission.campaign) extraNotes.push(`Campaign: ${submission.campaign}`);
  if (submission.dynamicFields) {
    for (const [key, val] of Object.entries(submission.dynamicFields)) {
      if (val !== undefined && val !== null && val !== '') {
        extraNotes.push(`${key}: ${val}`);
      }
    }
  }
  const extraNotesStr = extraNotes.length > 0 ? ` [${extraNotes.join(' | ')}]` : '';

  const fullNote = submission.message
    ? `[Inbound Form ${nowIso.slice(0, 10)}] ${submission.contactName} (${submission.contactEmail}): ${submission.message}${extraNotesStr}`
    : `[Inbound Form ${nowIso.slice(0, 10)}] Submitted by ${submission.contactName} (${submission.contactEmail}).${extraNotesStr}`;

  return {
    id: now.getTime(),
    region: submission.region,
    country: submission.country,
    entity_name: submission.entityName,
    url: submission.websiteUrl,
    contacts: [contact],
    contactEmails: [submission.contactEmail],
    address: submission.address || submission.postCode || '',
    cityName: submission.city || '',
    general_contact: submission.contactEmail,
    size: submission.organizationSize,
    industry: submission.industry || submission.sportOrSector || (submission.campaign ? `Campaign: ${submission.campaign}` : 'Inbound Web Inquiry'),
    sport_or_sector: submission.sportOrSector || '',
    level_league: '',
    pros: submission.message ? [`Inbound inquiry: ${submission.message.slice(0, 240)}`] : ['Inbound web lead collector inquiry'],
    cons: [],
    value_proposition: submission.message || `Inbound inquiry from ${submission.contactName} (${submission.entityName}).${extraNotesStr}`,
    recommended_tier: '',
    estimated_participants: 0,
    estimated_annual_revenue_usd: 0,
    revenue_model: '',
    product_fit_notes: submission.message || (submission.campaign ? `Acquired via ${submission.campaign}` : ''),
    pricingByCompany: {},
    ...(ticketSizeEstimate ? { ticketSizeEstimate } : {}),
    ...(assignedTo ? { assignedTo } : {}),
    status: 'new',
    notes: fullNote,
    tags: submission.campaign ? [submission.campaign] : [],
    deals: [],
    checklist: [],
    source: submission.campaign ? `landing_${submission.campaign}` : 'inbound',
    campaign: submission.campaign,
    extraFields: {
      postCode: submission.postCode,
      city: submission.city,
      address: submission.address,
      dateOfBirth: submission.dateOfBirth,
      consentPdc: submission.consentPdc,
      consentMrVegas: submission.consentMrVegas,
      dynamicFields: submission.dynamicFields,
    },
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
    nextActionNote: `Respond to lead inquiry from ${submission.contactName}`,
    createdAt: now,
    updatedAt: now,
  };
}
