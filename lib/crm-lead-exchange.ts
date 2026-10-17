// Multi-CRM Lead Exchange (Issue #254)
// Pure module for importing and exporting leads across HubSpot, Salesforce, Pipedrive, and Google Sheets.
// Follows RFC 4180 CSV standard with UTF-8 BOM, intelligent column auto-detection, and country/stage normalization.

import type { Lead, KanbanColumn } from '@/app/types';
import { isValidIsoCountry, ISO_COUNTRY_CODES } from './iso-country-codes';
import { getIceScore } from '@/app/constants';

export type CrmPreset = 'google_sheets' | 'hubspot' | 'salesforce' | 'pipedrive' | 'universal';

export type CrmPresetInfo = {
  id: CrmPreset;
  label: string;
  description: string;
  icon: 'google' | 'hubspot' | 'salesforce' | 'pipedrive' | 'csv';
  fileExtension: string;
  sampleHeaders: string[];
};

export const CRM_PRESETS: Record<CrmPreset, CrmPresetInfo> = {
  google_sheets: {
    id: 'google_sheets',
    label: 'Google Sheets / Universal CSV',
    description: 'Clean, universal tabular format designed for instant copy-paste or opening in Google Sheets and Excel.',
    icon: 'google',
    fileExtension: 'csv',
    sampleHeaders: ['Company Name', 'Website', 'Country', 'City', 'Pipeline Stage', 'Primary Contact Email'],
  },
  hubspot: {
    id: 'hubspot',
    label: 'HubSpot CRM',
    description: 'Formatted to match HubSpot Contacts & Companies import schema (Lifecycle Stage, Company Name, etc.).',
    icon: 'hubspot',
    fileExtension: 'csv',
    sampleHeaders: ['Company Name', 'Website URL', 'First Name', 'Last Name', 'Email', 'Lifecycle Stage'],
  },
  salesforce: {
    id: 'salesforce',
    label: 'Salesforce Sales Cloud',
    description: 'Formatted for Salesforce Lead object import with Company, Lead Status, Rating, and standard address fields.',
    icon: 'salesforce',
    fileExtension: 'csv',
    sampleHeaders: ['Company', 'FirstName', 'LastName', 'Email', 'Status', 'Rating', 'AnnualRevenue'],
  },
  pipedrive: {
    id: 'pipedrive',
    label: 'Pipedrive CRM',
    description: 'Formatted for Pipedrive Organizations, Persons, and Deals (Person - Name, Lead Value, Stage).',
    icon: 'pipedrive',
    fileExtension: 'csv',
    sampleHeaders: ['Organization Name', 'Person - Name', 'Person - Email', 'Lead Value', 'Stage'],
  },
  universal: {
    id: 'universal',
    label: 'Standard CSV',
    description: 'Standard comma-separated file with full lead attributes.',
    icon: 'csv',
    fileExtension: 'csv',
    sampleHeaders: ['Company Name', 'Website', 'Country', 'City', 'Pipeline Stage', 'Primary Contact Email'],
  },
};

// Common Country Name to ISO 3166-1 alpha-2 mapping
export const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // English & native variations
  'united states': 'US',
  'united states of america': 'US',
  'usa': 'US',
  'united kingdom': 'GB',
  'uk': 'GB',
  'great britain': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'northern ireland': 'GB',
  'spain': 'ES',
  'españa': 'ES',
  'germany': 'DE',
  'deutschland': 'DE',
  'france': 'FR',
  'italy': 'IT',
  'italia': 'IT',
  'hungary': 'HU',
  'magyarország': 'HU',
  'austria': 'AT',
  'österreich': 'AT',
  'switzerland': 'CH',
  'schweiz': 'CH',
  'suisse': 'CH',
  'netherlands': 'NL',
  'holland': 'NL',
  'nederland': 'NL',
  'belgium': 'BE',
  'belgique': 'BE',
  'sweden': 'SE',
  'sverige': 'SE',
  'norway': 'NO',
  'norge': 'NO',
  'denmark': 'DK',
  'danmark': 'DK',
  'finland': 'FI',
  'suomi': 'FI',
  'poland': 'PL',
  'polska': 'PL',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'česko': 'CZ',
  'slovakia': 'SK',
  'slovensko': 'SK',
  'romania': 'RO',
  'românia': 'RO',
  'bulgaria': 'BG',
  'croatia': 'HR',
  'hrvatska': 'HR',
  'serbia': 'RS',
  'srbija': 'RS',
  'slovenia': 'SI',
  'slovenija': 'SI',
  'portugal': 'PT',
  'greece': 'GR',
  'turkey': 'TR',
  'türkiye': 'TR',
  'ireland': 'IE',
  'canada': 'CA',
  'australia': 'AU',
  'new zealand': 'NZ',
  'japan': 'JP',
  'south korea': 'KR',
  'korea': 'KR',
  'china': 'CN',
  'india': 'IN',
  'singapore': 'SG',
  'hong kong': 'HK',
  'united arab emirates': 'AE',
  'uae': 'AE',
  'saudi arabia': 'SA',
  'qatar': 'QA',
  'kuwait': 'KW',
  'bahrain': 'BH',
  'oman': 'OM',
  'israel': 'IL',
  'south africa': 'ZA',
  'brazil': 'BR',
  'brasil': 'BR',
  'mexico': 'MX',
  'méxico': 'MX',
  'argentina': 'AR',
  'kosovo': 'XK',
};

export function normalizeCountryToIso(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return 'US';
  const clean = raw.trim().toUpperCase();
  if (isValidIsoCountry(clean)) return clean;

  const lower = raw.trim().toLowerCase();
  if (COUNTRY_NAME_TO_ISO[lower]) {
    return COUNTRY_NAME_TO_ISO[lower];
  }

  // Check prefix or partial match
  for (const [name, code] of Object.entries(COUNTRY_NAME_TO_ISO)) {
    if (lower.startsWith(name) || lower.includes(name)) {
      return code;
    }
  }

  return 'US';
}

export function normalizeCrmStageToKanban(raw?: string | null, defaultStage: KanbanColumn = 'DISCOVERED'): KanbanColumn {
  if (!raw || typeof raw !== 'string') return defaultStage;
  const s = raw.trim().toLowerCase();

  // Exact Kanban
  if (s === 'discovered' || s === 'new' || s === 'lead' || s === 'subscriber' || s === 'lead in' || s === 'open - not contacted' || s === 'open') {
    return 'DISCOVERED';
  }
  if (s === 'qualified' || s === 'marketingqualifiedlead' || s === 'mql' || s === 'contact made') {
    return 'QUALIFIED';
  }
  if (s === 'engaged' || s === 'salesqualifiedlead' || s === 'sql' || s === 'contacted' || s === 'working - contacted' || s === 'needs defined' || s === 'in progress') {
    return 'ENGAGED';
  }
  if (s === 'proposal' || s === 'opportunity' || s === 'open deal' || s === 'proposal sent' || s === 'negotiation' || s === 'quote sent') {
    return 'PROPOSAL';
  }
  if (s === 'won' || s === 'closed won' || s === 'closed - converted' || s === 'customer' || s === 'evangelist') {
    return 'WON';
  }
  if (s === 'lost' || s === 'closed lost' || s === 'closed - not converted' || s === 'unqualified' || s === 'declined' || s === 'rejected') {
    return 'LOST';
  }
  if (s === 'backlog' || s === 'idea' || s === 'deferred' || s === 'snoozed') {
    return 'BACKLOG';
  }

  return defaultStage;
}

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('\t') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((r) => r.map(escapeCsvCell).join(','));
  // Prepend UTF-8 BOM (\uFEFF) so Excel & Google Sheets correctly decode unicode/diacritics
  return '\uFEFF' + [headerLine, ...rowLines].join('\n');
}

export function splitFullName(fullName?: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

// -------------------------------------------------------------
// EXPORT FORMATTERS
// -------------------------------------------------------------

export function exportLeadsToCsv(leads: Partial<Lead>[], preset: CrmPreset = 'google_sheets', _brand?: string): string {
  switch (preset) {
    case 'hubspot': {
      const headers = [
        'Company Name',
        'Website URL',
        'First Name',
        'Last Name',
        'Job Title',
        'Email',
        'Phone Number',
        'Lifecycle Stage',
        'Lead Status',
        'Annual Revenue',
        'Industry',
        'City',
        'Country/Region',
        'Description',
        'HubSpot Owner',
      ];

      const rows = leads.map((lead) => {
        const contact = (lead.contacts && lead.contacts[0]) || {};
        const { firstName, lastName } = splitFullName(contact.name);

        let lifecycleStage = 'lead';
        let leadStatus = 'NEW';
        switch (lead.kanbanColumn) {
          case 'DISCOVERED':
            lifecycleStage = 'lead';
            leadStatus = 'NEW';
            break;
          case 'QUALIFIED':
            lifecycleStage = 'marketingqualifiedlead';
            leadStatus = 'QUALIFIED';
            break;
          case 'ENGAGED':
            lifecycleStage = 'salesqualifiedlead';
            leadStatus = 'IN_PROGRESS';
            break;
          case 'PROPOSAL':
            lifecycleStage = 'opportunity';
            leadStatus = 'OPEN_DEAL';
            break;
          case 'WON':
            lifecycleStage = 'customer';
            leadStatus = 'CONNECTED';
            break;
          case 'LOST':
            lifecycleStage = 'other';
            leadStatus = 'UNQUALIFIED';
            break;
          case 'BACKLOG':
            lifecycleStage = 'subscriber';
            leadStatus = 'OPEN';
            break;
        }

        const estRev = lead.ticketSizeEstimate?.expected || lead.estimated_annual_revenue_usd || '';

        return [
          lead.entity_name || '',
          lead.url || '',
          firstName,
          lastName,
          contact.title || '',
          contact.email || '',
          contact.phone || '',
          lifecycleStage,
          leadStatus,
          estRev,
          lead.industry || lead.sport_or_sector || '',
          lead.cityName || '',
          lead.country || lead.region || '',
          lead.notes || lead.value_proposition || '',
          lead.assignedToEmail || '',
        ];
      });

      return buildCsv(headers, rows);
    }

    case 'salesforce': {
      const headers = [
        'Company',
        'FirstName',
        'LastName',
        'Title',
        'Email',
        'Phone',
        'Website',
        'Status',
        'Rating',
        'Industry',
        'Country',
        'City',
        'Street',
        'AnnualRevenue',
        'Description',
      ];

      const rows = leads.map((lead) => {
        const contact = (lead.contacts && lead.contacts[0]) || {};
        const { firstName, lastName } = splitFullName(contact.name);

        let status = 'Open - Not Contacted';
        switch (lead.kanbanColumn) {
          case 'DISCOVERED':
            status = 'Open - Not Contacted';
            break;
          case 'QUALIFIED':
          case 'ENGAGED':
          case 'PROPOSAL':
            status = 'Working - Contacted';
            break;
          case 'WON':
            status = 'Closed - Converted';
            break;
          case 'LOST':
            status = 'Closed - Not Converted';
            break;
          default:
            status = 'Open - Not Contacted';
        }

        const score = getIceScore(lead);
        const rating = score >= 120 ? 'Hot' : score >= 60 ? 'Warm' : 'Cold';
        const estRev = lead.ticketSizeEstimate?.expected || lead.estimated_annual_revenue_usd || '';

        return [
          lead.entity_name || '',
          firstName,
          lastName,
          contact.title || '',
          contact.email || '',
          contact.phone || '',
          lead.url || '',
          status,
          rating,
          lead.industry || lead.sport_or_sector || '',
          lead.country || 'US',
          lead.cityName || '',
          lead.address || '',
          estRev,
          lead.notes || lead.value_proposition || '',
        ];
      });

      return buildCsv(headers, rows);
    }

    case 'pipedrive': {
      const headers = [
        'Organization Name',
        'Person - Name',
        'Person - Email',
        'Person - Phone',
        'Person - Job Title',
        'Lead Title',
        'Lead Value',
        'Stage',
        'Organization Address',
        'Notes',
        'Labels',
      ];

      const rows = leads.map((lead) => {
        const contact = (lead.contacts && lead.contacts[0]) || {};

        let stage = 'Lead In';
        switch (lead.kanbanColumn) {
          case 'DISCOVERED':
            stage = 'Lead In';
            break;
          case 'QUALIFIED':
            stage = 'Contact Made';
            break;
          case 'ENGAGED':
            stage = 'Needs Defined';
            break;
          case 'PROPOSAL':
            stage = 'Proposal Sent';
            break;
          case 'WON':
            stage = 'Won';
            break;
          case 'LOST':
            stage = 'Lost';
            break;
          default:
            stage = 'Idea';
        }

        const estRev = lead.ticketSizeEstimate?.expected || lead.estimated_annual_revenue_usd || '';
        const tags = Array.isArray(lead.tags) ? lead.tags.join('; ') : '';

        return [
          lead.entity_name || '',
          contact.name || '',
          contact.email || '',
          contact.phone || '',
          contact.title || '',
          `${lead.entity_name || 'Deal'} - Lead`,
          estRev,
          stage,
          lead.address || lead.cityName || '',
          lead.notes || lead.value_proposition || '',
          tags,
        ];
      });

      return buildCsv(headers, rows);
    }

    case 'google_sheets':
    case 'universal':
    default: {
      const headers = [
        'Company Name',
        'Website',
        'Country',
        'City',
        'Region',
        'Industry / Sector',
        'Pipeline Stage',
        'ICE Score',
        'Estimated Deal Value',
        'Primary Contact Name',
        'Primary Contact Title',
        'Primary Contact Email',
        'Primary Contact Phone',
        'Primary Contact LinkedIn',
        'Buying Role',
        'Value Proposition',
        'Notes',
        'Tags',
        'Lead ID',
      ];

      const rows = leads.map((lead) => {
        const contact = (lead.contacts && lead.contacts[0]) || {};
        const estRev = lead.ticketSizeEstimate?.expected || lead.estimated_annual_revenue_usd || '';
        const tags = Array.isArray(lead.tags) ? lead.tags.join(', ') : '';

        return [
          lead.entity_name || '',
          lead.url || '',
          lead.country || '',
          lead.cityName || '',
          lead.region || '',
          lead.sport_or_sector || lead.industry || '',
          lead.kanbanColumn || 'DISCOVERED',
          getIceScore(lead) || '',
          estRev,
          contact.name || '',
          contact.title || '',
          contact.email || '',
          contact.phone || '',
          contact.linkedin || '',
          contact.buyingRole || '',
          lead.value_proposition || '',
          lead.notes || '',
          tags,
          lead._id || '',
        ];
      });

      return buildCsv(headers, rows);
    }
  }
}

export function exportLeadsToGoogleSheetsTsv(leads: Partial<Lead>[]): string {
  const headers = [
    'Company Name',
    'Website',
    'Country',
    'City',
    'Region',
    'Industry / Sector',
    'Pipeline Stage',
    'ICE Score',
    'Estimated Deal Value',
    'Primary Contact Name',
    'Primary Contact Title',
    'Primary Contact Email',
    'Primary Contact Phone',
    'Notes',
  ];

  const rows = leads.map((lead) => {
    const contact = (lead.contacts && lead.contacts[0]) || {};
    const estRev = lead.ticketSizeEstimate?.expected || lead.estimated_annual_revenue_usd || '';
    return [
      lead.entity_name || '',
      lead.url || '',
      lead.country || '',
      lead.cityName || '',
      lead.region || '',
      lead.sport_or_sector || lead.industry || '',
      lead.kanbanColumn || 'DISCOVERED',
      getIceScore(lead) || '',
      estRev,
      contact.name || '',
      contact.title || '',
      contact.email || '',
      contact.phone || '',
      lead.notes || lead.value_proposition || '',
    ].map((val) => String(val ?? '').replace(/\t/g, ' ').replace(/\n/g, ' '));
  });

  return [headers.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}

// -------------------------------------------------------------
// IMPORT PARSERS & DETECTORS
// -------------------------------------------------------------

export function parseCsvOrTsv(rawText: string): { headers: string[]; rows: string[][] } {
  if (!rawText || !rawText.trim()) {
    return { headers: [], rows: [] };
  }

  // Strip UTF-8 BOM if present
  let cleanText = rawText;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  // Detect delimiter: check first line for tabs, commas, or semicolons
  const firstLine = cleanText.split(/\r?\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ',';
  if (tabCount > commaCount && tabCount > semicolonCount) delimiter = '\t';
  else if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = ';';

  // RFC 4180 State Machine Parser
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < cleanText.length) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRecord.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRecord.push(currentField.trim());
        currentField = '';
        if (currentRecord.some((f) => f.length > 0)) {
          records.push(currentRecord);
        }
        currentRecord = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRecord.push(currentField.trim());
        currentField = '';
        if (currentRecord.some((f) => f.length > 0)) {
          records.push(currentRecord);
        }
        currentRecord = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField.trim());
    if (currentRecord.some((f) => f.length > 0)) {
      records.push(currentRecord);
    }
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.replace(/^["']|["']$/g, '').trim());
  const rows = records.slice(1);
  return { headers, rows };
}

export function detectCrmPreset(headers: string[]): CrmPreset {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // HubSpot detection
  if (
    norm.includes('hubspotowner') ||
    norm.includes('lifecyclestage') ||
    (norm.includes('companyname') && norm.includes('websiteurl'))
  ) {
    return 'hubspot';
  }

  // Salesforce detection (CamelCase FirstName/LastName/Company/Status, or AnnualRevenue)
  if (
    norm.includes('annualrevenue') ||
    norm.includes('leadstatus') ||
    (norm.includes('firstname') && norm.includes('lastname') && (norm.includes('company') || norm.includes('status'))) ||
    (norm.includes('rating') && norm.includes('company'))
  ) {
    return 'salesforce';
  }

  // Pipedrive detection
  if (
    norm.includes('personname') ||
    norm.includes('organizationname') ||
    norm.includes('leadvalue') ||
    norm.includes('dealtitle')
  ) {
    return 'pipedrive';
  }

  return 'google_sheets';
}

function findFieldValue(row: Record<string, string>, possibleKeys: string[]): string {
  const normalizedRowKeys = Object.keys(row).map((k) => ({
    raw: k,
    clean: k.toLowerCase().replace(/[^a-z0-9]/g, ''),
  }));

  for (const key of possibleKeys) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = normalizedRowKeys.find((k) => k.clean === cleanKey || k.clean.includes(cleanKey));
    if (found && row[found.raw]) {
      return row[found.raw].trim();
    }
  }
  return '';
}

export function mapRowToLeadPayload(
  row: Record<string, string>,
  preset: CrmPreset,
  defaultStage: KanbanColumn = 'DISCOVERED'
): Partial<Lead> {
  const entityName =
    findFieldValue(row, ['company name', 'company', 'organization name', 'organization', 'account name', 'name', 'entity name']) ||
    'Unknown Organization';

  let rawUrl = findFieldValue(row, ['website url', 'website', 'domain', 'url', 'web']);
  if (rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }

  const cityName = findFieldValue(row, ['city', 'city name', 'town']);
  const address = findFieldValue(row, ['street', 'address', 'organization address', 'full address']);

  let rawCountry = findFieldValue(row, ['country/region', 'country', 'country code', 'nation']);
  if (!rawCountry && address) {
    // If country is embedded inside a single-string address (e.g. "Turin, Italy"), extract it
    rawCountry = address;
  }
  const country = normalizeCountryToIso(rawCountry);

  const industry = findFieldValue(row, ['industry', 'sector', 'industry / sector', 'market', 'sport / sector']);
  const sportOrSector = findFieldValue(row, ['sport_or_sector', 'sport', 'category']) || industry;

  const rawStage = findFieldValue(row, ['pipeline stage', 'stage', 'status', 'lifecycle stage', 'lead status']);
  const kanbanColumn = normalizeCrmStageToKanban(rawStage, defaultStage);

  // Contact resolution
  let contactName = findFieldValue(row, ['contact name', 'person - name', 'person name', 'contact', 'full name', 'lead name']);
  const firstName = findFieldValue(row, ['first name', 'firstname']);
  const lastName = findFieldValue(row, ['last name', 'lastname']);
  if (!contactName && (firstName || lastName)) {
    contactName = `${firstName} ${lastName}`.trim();
  }

  const contactEmail = findFieldValue(row, ['email', 'contact email', 'person - email', 'person email', 'work email']);
  const contactPhone = findFieldValue(row, ['phone', 'phone number', 'contact phone', 'person - phone', 'mobile']);
  const contactTitle = findFieldValue(row, ['job title', 'title', 'person - job title', 'role', 'position']);
  const contactLinkedin = findFieldValue(row, ['linkedin', 'linkedin url', 'person linkedin']);

  const contacts: NonNullable<Lead['contacts']> = [];
  if (contactName || contactEmail || contactPhone || contactTitle) {
    contacts.push({
      name: contactName || undefined,
      email: contactEmail || undefined,
      phone: contactPhone || undefined,
      title: contactTitle || undefined,
      linkedin: contactLinkedin || undefined,
      buyingRole: 'unknown',
    });
  }

  const notes = findFieldValue(row, ['description', 'notes', 'lead note', 'lead description', 'comments', 'value proposition']);
  const valueProp = findFieldValue(row, ['value proposition', 'value_proposition', 'pro_for_organization']);

  const dealValueStr = findFieldValue(row, ['annual revenue', 'annualrevenue', 'lead value', 'deal value', 'estimated deal value', 'estimated_annual_revenue_usd']);
  const dealValueNum = dealValueStr ? parseFloat(dealValueStr.replace(/[^0-9.]/g, '')) : undefined;

  const rawScore = findFieldValue(row, ['ice score', 'score', 'ice_score']);
  const scoreNum = rawScore ? parseInt(rawScore, 10) : undefined;

  const tagsStr = findFieldValue(row, ['tags', 'labels', 'categories']);
  const tags = tagsStr
    ? tagsStr.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
    : [];

  tags.push('crm-import', `source:${preset}`);

  return {
    entity_name: entityName,
    url: rawUrl || undefined,
    country,
    cityName: cityName || undefined,
    address: address || undefined,
    region: cityName ? `${cityName}, ${country}` : country,
    industry: industry || undefined,
    sport_or_sector: sportOrSector || undefined,
    kanbanColumn,
    contacts,
    notes: notes || undefined,
    value_proposition: valueProp || undefined,
    estimated_annual_revenue_usd: Number.isFinite(dealValueNum) ? dealValueNum : undefined,
    ice: Number.isFinite(scoreNum)
      ? { impact: Math.min(10, Math.max(1, Math.round(Math.cbrt(scoreNum!)))), confidence: 5, ease: 5 }
      : undefined,
    tags: Array.from(new Set(tags)),
  };
}

export type CrmImportResult = {
  preset: CrmPreset;
  headers: string[];
  totalRows: number;
  validLeads: Partial<Lead>[];
  preview: Array<{
    original: Record<string, string>;
    mapped: Partial<Lead>;
    errors?: string[];
  }>;
  warnings: string[];
};

export function parseCrmImport(
  rawText: string,
  options?: { forcedPreset?: CrmPreset; defaultStage?: KanbanColumn }
): CrmImportResult {
  const { headers, rows } = parseCsvOrTsv(rawText);
  if (headers.length === 0 || rows.length === 0) {
    return {
      preset: options?.forcedPreset || 'google_sheets',
      headers: [],
      totalRows: 0,
      validLeads: [],
      preview: [],
      warnings: ['No data rows found in input text.'],
    };
  }

  const preset = options?.forcedPreset || detectCrmPreset(headers);
  const validLeads: Partial<Lead>[] = [];
  const preview: CrmImportResult['preview'] = [];
  const warnings: string[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const rowArray = rows[idx];
    const rowObj: Record<string, string> = {};
    headers.forEach((h, i) => {
      rowObj[h] = rowArray[i] ?? '';
    });

    const mapped = mapRowToLeadPayload(rowObj, preset, options?.defaultStage);
    const rowErrors: string[] = [];

    if (!mapped.entity_name || mapped.entity_name === 'Unknown Organization') {
      rowErrors.push('Missing company or organization name');
    }

    if (rowErrors.length === 0) {
      validLeads.push(mapped);
    }

    if (idx < 5) {
      preview.push({
        original: rowObj,
        mapped,
        errors: rowErrors.length > 0 ? rowErrors : undefined,
      });
    }
  }

  if (validLeads.length === 0 && rows.length > 0) {
    warnings.push('Could not extract any valid leads with company names from the provided data.');
  }

  return {
    preset,
    headers,
    totalRows: rows.length,
    validLeads,
    preview,
    warnings,
  };
}
