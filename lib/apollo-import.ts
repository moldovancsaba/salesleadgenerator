import type { Lead } from '@/app/types';
import { fetchWithRetry } from './integration-http';
import { normalizeCountryToIso } from './crm-lead-exchange';
import { normalizeDepartmentInput, type Department } from './title-normalization';
import { normalizePhone, normalizeEmail } from './contacts';

export const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';

export type ApolloEntitlementCheck = {
  healthy: boolean;
  isLoggedIn: boolean;
  savedContactsAllowed: boolean;
  savedContactsReason?: string;
  globalSearchAllowed: boolean;
  globalSearchReason?: string;
  recommendedMode: 'global_search' | 'saved_contacts' | 'csv_only' | 'unauthorized';
  goDecision: 'go_api' | 'go_saved_contacts_only' | 'no_go_api_use_csv';
  diagnosticSummary: string;
  prerequisites: string[];
};

export type ApolloRawPerson = Record<string, any>;
export type ApolloFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type MappedApolloCandidate = {
  apolloPersonId: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  department: Department;
  email: string;
  phone: string;
  linkedin: string;
  country: string;
  companyName: string;
  companyWebsite: string;
  companyLinkedin: string;
  companyPhone: string;
  industry: string;
  cityName: string;
  missingFields: string[];
  leadPayload: Partial<Lead>;
};

export function buildApolloHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey.trim(),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };
}

export const APOLLO_PREREQUISITES: string[] = [
  'Create an API key in Apollo (Settings → Integrations → API → API Keys).',
  'Pass credentials via the x-api-key HTTP header (query/body api_key is deprecated by Apollo).',
  'Saved CRM Contacts search (/api/v1/contacts/search) works with standard API keys enabled for Contacts.',
  'Global Prospect Search (/api/v1/mixed_people/search) requires an Apollo plan with API search access and a Master API Key.',
  'If your Apollo plan restricts API search, export selected contacts as CSV in Apollo and import via the Apollo CSV preset.',
];

export async function verifyApolloHealth(
  apiKey: string,
  fetchFn: ApolloFetchFn = fetchWithRetry
): Promise<{ ok: boolean; healthy: boolean; isLoggedIn: boolean; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, healthy: false, isLoggedIn: false, error: 'API key is required' };
  }
  try {
    const res = await fetchFn(`${APOLLO_API_BASE}/auth/health`, {
      method: 'GET',
      headers: buildApolloHeaders(apiKey),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        healthy: false,
        isLoggedIn: false,
        error: body?.error || body?.message || `Apollo health check returned HTTP ${res.status}`,
      };
    }
    const healthy = body?.healthy !== false;
    const isLoggedIn = body?.is_logged_in !== false;
    return {
      ok: healthy && isLoggedIn,
      healthy,
      isLoggedIn,
      error: healthy && isLoggedIn ? undefined : 'Apollo key is not mapped to an active logged-in workspace',
    };
  } catch {
    return {
      ok: false,
      healthy: false,
      isLoggedIn: false,
      error: 'Could not reach Apollo API health endpoint',
    };
  }
}

export async function checkApolloEntitlements(
  apiKey: string,
  fetchFn: ApolloFetchFn = fetchWithRetry
): Promise<ApolloEntitlementCheck> {
  const health = await verifyApolloHealth(apiKey, fetchFn);
  if (!health.ok) {
    return {
      healthy: health.healthy,
      isLoggedIn: health.isLoggedIn,
      savedContactsAllowed: false,
      savedContactsReason: health.error,
      globalSearchAllowed: false,
      globalSearchReason: health.error,
      recommendedMode: 'unauthorized',
      goDecision: 'no_go_api_use_csv',
      diagnosticSummary: health.error || 'Apollo API key could not be verified.',
      prerequisites: APOLLO_PREREQUISITES,
    };
  }

  let savedContactsAllowed = false;
  let savedContactsReason: string | undefined;
  try {
    const contactsRes = await fetchFn(`${APOLLO_API_BASE}/contacts/search`, {
      method: 'POST',
      headers: buildApolloHeaders(apiKey),
      body: JSON.stringify({ page: 1, per_page: 1 }),
    });
    const contactsBody = await contactsRes.json().catch(() => ({}));
    if (contactsRes.ok) {
      savedContactsAllowed = true;
    } else {
      savedContactsReason =
        contactsBody?.error ||
        contactsBody?.message ||
        `HTTP ${contactsRes.status} on /api/v1/contacts/search`;
    }
  } catch {
    savedContactsReason = 'Network error checking /api/v1/contacts/search';
  }

  let globalSearchAllowed = false;
  let globalSearchReason: string | undefined;
  try {
    const searchRes = await fetchFn(`${APOLLO_API_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: buildApolloHeaders(apiKey),
      body: JSON.stringify({ page: 1, per_page: 1 }),
    });
    const searchBody = await searchRes.json().catch(() => ({}));
    if (searchRes.ok) {
      globalSearchAllowed = true;
    } else {
      globalSearchReason =
        searchBody?.error ||
        searchBody?.message ||
        `HTTP ${searchRes.status} on /api/v1/mixed_people/search (Master Key / paid API plan required)`;
    }
  } catch {
    globalSearchReason = 'Network error checking /api/v1/mixed_people/search';
  }

  if (globalSearchAllowed) {
    return {
      healthy: true,
      isLoggedIn: true,
      savedContactsAllowed,
      savedContactsReason,
      globalSearchAllowed: true,
      recommendedMode: 'global_search',
      goDecision: 'go_api',
      diagnosticSummary:
        'Full API entitlement confirmed: both Global Prospect Search and Saved Contacts lookup are permitted.',
      prerequisites: APOLLO_PREREQUISITES,
    };
  }

  if (savedContactsAllowed) {
    return {
      healthy: true,
      isLoggedIn: true,
      savedContactsAllowed: true,
      globalSearchAllowed: false,
      globalSearchReason,
      recommendedMode: 'saved_contacts',
      goDecision: 'go_saved_contacts_only',
      diagnosticSummary:
        'Saved CRM Contacts lookup is permitted. Global Prospect Search is plan/master-key restricted on this key; save prospects in Apollo first or use Apollo CSV import.',
      prerequisites: APOLLO_PREREQUISITES,
    };
  }

  return {
    healthy: true,
    isLoggedIn: true,
    savedContactsAllowed: false,
    savedContactsReason,
    globalSearchAllowed: false,
    globalSearchReason,
    recommendedMode: 'csv_only',
    goDecision: 'no_go_api_use_csv',
    diagnosticSummary:
      'Account authenticated, but contact search endpoints are not entitled on this plan/API key. No-go for direct API pull; use Apollo CSV export preset instead.',
    prerequisites: APOLLO_PREREQUISITES,
  };
}

function cleanHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function extractApolloPersonPhone(person: ApolloRawPerson): string {
  if (Array.isArray(person?.phone_numbers)) {
    for (const p of person.phone_numbers) {
      const candidate = p?.sanitized_number || p?.raw_number || p?.number;
      if (typeof candidate === 'string' && candidate.trim()) {
        return normalizePhone(candidate.trim());
      }
    }
  }
  const direct =
    person?.sanitized_phone ||
    person?.direct_phone ||
    person?.mobile_phone ||
    person?.phone;
  if (typeof direct === 'string' && direct.trim()) {
    return normalizePhone(direct.trim());
  }
  return '';
}

function extractApolloCompanyPhone(person: ApolloRawPerson): string {
  const org = person?.organization || person?.account || {};
  const candidate =
    org?.primary_phone?.sanitized_number ||
    org?.primary_phone?.number ||
    org?.sanitized_phone ||
    org?.phone ||
    person?.corporate_phone ||
    person?.organization_phone;
  if (typeof candidate === 'string' && candidate.trim()) {
    return normalizePhone(candidate.trim());
  }
  return '';
}

export function mapApolloPersonToLead(person: ApolloRawPerson): MappedApolloCandidate {
  const org = person?.organization || person?.account || {};
  const firstName = typeof person?.first_name === 'string' ? person.first_name.trim() : '';
  const lastName = typeof person?.last_name === 'string' ? person.last_name.trim() : '';
  const rawName = typeof person?.name === 'string' ? person.name.trim() : '';
  const name = rawName || [firstName, lastName].filter(Boolean).join(' ').trim();

  const title = typeof person?.title === 'string' ? person.title.trim() : '';
  const rawDept = Array.isArray(person?.departments) && person.departments.length > 0
    ? String(person.departments[0] || '')
    : typeof person?.department === 'string'
    ? person.department
    : '';
  const department = normalizeDepartmentInput(rawDept || title);

  const rawEmail = typeof person?.email === 'string' ? person.email.trim() : '';
  // Apollo sometimes returns placeholder "email_not_unlocked@domain.com" on locked records
  const email =
    rawEmail && !rawEmail.toLowerCase().startsWith('email_not_unlocked@')
      ? normalizeEmail(rawEmail)
      : '';

  const phone = extractApolloPersonPhone(person);
  const linkedin = cleanHttpUrl(person?.linkedin_url || person?.person_linkedin_url);

  const rawCountry =
    person?.country ||
    org?.country ||
    person?.present_raw_address ||
    '';
  const country = rawCountry ? normalizeCountryToIso(String(rawCountry)) : '';

  const companyName =
    (typeof org?.name === 'string' && org.name.trim()) ||
    (typeof person?.organization_name === 'string' && person.organization_name.trim()) ||
    (typeof person?.account?.name === 'string' && person.account.name.trim()) ||
    '';

  const companyWebsite = cleanHttpUrl(
    org?.website_url ||
      org?.primary_domain ||
      person?.website_url ||
      person?.organization_website_url
  );
  const companyLinkedin = cleanHttpUrl(
    org?.linkedin_url || person?.company_linkedin_url || person?.organization_linkedin_url
  );
  const companyPhone = extractApolloCompanyPhone(person);

  const industry =
    (typeof org?.industry === 'string' && org.industry.trim()) ||
    (typeof person?.industry === 'string' && person.industry.trim()) ||
    '';

  const cityName =
    (typeof person?.city === 'string' && person.city.trim()) ||
    (typeof org?.city === 'string' && org.city.trim()) ||
    '';

  const missingFields: string[] = [];
  if (!firstName) missingFields.push('firstName');
  if (!lastName) missingFields.push('lastName');
  if (!country) missingFields.push('country');
  if (!companyName) missingFields.push('company');
  if (!title) missingFields.push('title');
  if (department === 'Unknown') missingFields.push('department');
  if (!industry) missingFields.push('industry');
  if (!email) missingFields.push('email');
  if (!linkedin) missingFields.push('linkedin');
  if (!phone) missingFields.push('phone');
  if (!companyWebsite) missingFields.push('companyWebsite');
  if (!companyLinkedin) missingFields.push('companyLinkedin');
  if (!companyPhone) missingFields.push('companyPhone');

  const safeCountry = country || 'US';
  const apolloPersonId = String(person?.id || person?.contact_id || `${name}-${email || linkedin}`);

  const leadPayload: Partial<Lead> = {
    entity_name: companyName || (name ? `${name} Organization` : 'Unknown Organization'),
    url: companyWebsite || undefined,
    companyLinkedin: companyLinkedin || undefined,
    companyPhone: companyPhone || undefined,
    country: safeCountry,
    cityName: cityName || undefined,
    region: cityName ? `${cityName}, ${safeCountry}` : safeCountry,
    industry: industry || undefined,
    sport_or_sector: industry || undefined,
    source: 'apollo',
    kanbanColumn: 'DISCOVERED',
    tags: ['apollo-import', 'source:apollo'],
    contacts: [
      {
        name: name || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        title: title || undefined,
        departmentOverride: department !== 'Unknown' ? department : undefined,
        country: country || undefined,
        email: email || undefined,
        phone: phone || undefined,
        linkedin: linkedin || undefined,
        buyingRole: 'unknown',
      },
    ],
  };

  return {
    apolloPersonId,
    firstName,
    lastName,
    name,
    title,
    department,
    email,
    phone,
    linkedin,
    country,
    companyName,
    companyWebsite,
    companyLinkedin,
    companyPhone,
    industry,
    cityName,
    missingFields,
    leadPayload,
  };
}

export async function searchApolloContacts(
  apiKey: string,
  options: {
    query?: string;
    mode?: 'saved_contacts' | 'global_search';
    page?: number;
    perPage?: number;
  } = {},
  fetchFn: ApolloFetchFn = fetchWithRetry
): Promise<{
  ok: boolean;
  modeUsed: 'saved_contacts' | 'global_search';
  candidates: MappedApolloCandidate[];
  totalEntries: number;
  page: number;
  totalPages: number;
  error?: string;
  entitlementBlocked?: boolean;
}> {
  const mode = options.mode || 'saved_contacts';
  const page = Math.max(1, options.page || 1);
  const perPage = Math.max(1, Math.min(100, options.perPage || 25));
  const endpoint =
    mode === 'global_search'
      ? `${APOLLO_API_BASE}/mixed_people/search`
      : `${APOLLO_API_BASE}/contacts/search`;

  const payload: Record<string, any> = {
    page,
    per_page: perPage,
  };
  if (options.query && options.query.trim()) {
    payload.q_keywords = options.query.trim();
  }

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: buildApolloHeaders(apiKey),
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const entitlementBlocked = res.status === 401 || res.status === 403 || res.status === 422;
      return {
        ok: false,
        modeUsed: mode,
        candidates: [],
        totalEntries: 0,
        page,
        totalPages: 0,
        entitlementBlocked,
        error:
          body?.error ||
          body?.message ||
          `Apollo ${mode === 'global_search' ? 'Global Search' : 'Saved Contacts'} returned HTTP ${res.status}`,
      };
    }

    const rawPeople: ApolloRawPerson[] = Array.isArray(body?.contacts)
      ? body.contacts
      : Array.isArray(body?.people)
      ? body.people
      : [];

    const candidates = rawPeople.map(mapApolloPersonToLead);
    const pagination = body?.pagination || {};
    const totalEntries =
      typeof pagination.total_entries === 'number' ? pagination.total_entries : candidates.length;
    const totalPages =
      typeof pagination.total_pages === 'number'
        ? pagination.total_pages
        : Math.max(1, Math.ceil(totalEntries / perPage));

    return {
      ok: true,
      modeUsed: mode,
      candidates,
      totalEntries,
      page,
      totalPages,
    };
  } catch {
    return {
      ok: false,
      modeUsed: mode,
      candidates: [],
      totalEntries: 0,
      page,
      totalPages: 0,
      error: 'Could not reach Apollo search endpoint',
    };
  }
}
