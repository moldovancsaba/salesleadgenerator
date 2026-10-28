// Unified template personalization and token interpolation engine (issue #241).
// Ingests CRM Handoff 10 (Template Personalization) into Sales Lead Generator:
// provides a single canonical catalog of standard contact and company tokens,
// supports {token}, {{token}}, and {{.token}} merge variable syntax, derives
// first_name and last_name from contact name, and validates required fields
// to prevent outreach sends with blank or missing variables.

import type { NormalizedContact } from './contacts';
import { generateDomainAuditPitch } from './domain-audit-pitch';

export const CANONICAL_TOKENS = {
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  CONTACT_NAME: 'contact_name',
  EMAIL: 'email',
  SECONDARY_EMAIL: 'secondary_email',
  PHONE: 'phone',
  LINKEDIN_URL: 'linkedin_url',
  JOB_TITLE: 'job_title',
  COMPANY_NAME: 'company_name',
  COMPANY_WEBSITE: 'company_website',
  INDUSTRY: 'industry',
  DIGITAL_AUDIT_PITCH: 'digital_audit_pitch',
} as const;

export type CanonicalTokenKey = typeof CANONICAL_TOKENS[keyof typeof CANONICAL_TOKENS];

export const TOKEN_ALIASES: Record<string, CanonicalTokenKey> = {
  // First name
  first_name: 'first_name',
  firstname: 'first_name',
  'first name': 'first_name',
  // Last name
  last_name: 'last_name',
  lastname: 'last_name',
  'last name': 'last_name',
  // Contact name
  contact_name: 'contact_name',
  contactname: 'contact_name',
  'contact name': 'contact_name',
  name: 'contact_name',
  // Email
  email: 'email',
  // Secondary email
  secondary_email: 'secondary_email',
  secondaryemail: 'secondary_email',
  'secondary email': 'secondary_email',
  // Phone
  phone: 'phone',
  // LinkedIn
  linkedin_url: 'linkedin_url',
  linkedin: 'linkedin_url',
  'linkedin url': 'linkedin_url',
  // Job title
  job_title: 'job_title',
  jobtitle: 'job_title',
  'job title': 'job_title',
  title: 'job_title',
  // Company / Entity name
  company_name: 'company_name',
  companyname: 'company_name',
  'company name': 'company_name',
  company: 'company_name',
  entity_name: 'company_name',
  entityname: 'company_name',
  'entity name': 'company_name',
  // Website
  company_website: 'company_website',
  companywebsite: 'company_website',
  'company website': 'company_website',
  website: 'company_website',
  // Industry
  industry: 'industry',
  // Digital Audit Pitch (Issue 293)
  digital_audit_pitch: 'digital_audit_pitch',
  digitalauditpitch: 'digital_audit_pitch',
  'digital audit pitch': 'digital_audit_pitch',
  audit_pitch: 'digital_audit_pitch',
  auditpitch: 'digital_audit_pitch',
};

/**
 * Resolves a token identifier (e.g. "FirstName", "entity_name", "company") to its canonical key.
 */
export function resolveCanonicalToken(token: string): string {
  const clean = token.trim().toLowerCase();
  return TOKEN_ALIASES[clean] || clean;
}

/**
 * Splits a full name into first and last name components.
 */
export function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

export type PersonalizationInput = {
  lead?: Record<string, any> | null;
  contact?: NormalizedContact | null;
  extra?: Record<string, string> | null;
};

/**
 * Builds the complete dictionary of interpolation values for a given lead and contact.
 */
export function buildPersonalizationContext(input: PersonalizationInput): Record<string, string> {
  const { lead, contact, extra } = input;
  const context: Record<string, string> = {};

  // 1. Lead / Organization level defaults
  const entityName = lead?.entity_name || lead?.company_name || lead?.name || '';
  const website = lead?.website || lead?.company_website || '';
  const industry = lead?.industry || lead?.sport_or_sector || '';

  context.company_name = entityName;
  context.company_website = website;
  context.industry = industry;

  // 2. Contact level attributes
  const contactName = contact?.name || '';
  const explicitFirst = contact?.firstName || '';
  const explicitLast = contact?.lastName || '';
  const { firstName: derivedFirst, lastName: derivedLast } = splitContactName(contactName);

  const firstName = explicitFirst || derivedFirst;
  const lastName = explicitLast || derivedLast;

  context.contact_name = contactName;
  context.first_name = firstName;
  context.last_name = lastName;
  context.email = contact?.email || '';
  context.secondary_email = contact?.secondaryEmail || '';
  context.phone = contact?.phone || '';
  context.linkedin_url = contact?.linkedin || '';
  context.job_title = contact?.title || contact?.role || '';

  // Digital audit pitch hook if tech stack signals exist on lead
  const signals = lead?.techSignals || lead?.techStackSignals;
  if (signals && Array.isArray(signals) && signals.length > 0) {
    const pitchSummary = generateDomainAuditPitch(entityName, signals, lead?.techSignalsScannedAt || lead?.techStackScannedAt);
    context.digital_audit_pitch = pitchSummary.recommendedPitch;
  } else if (!context.digital_audit_pitch) {
    context.digital_audit_pitch = '';
  }

  // 3. Populate aliases into context so exact lookups succeed on any alias
  for (const [alias, canonical] of Object.entries(TOKEN_ALIASES)) {
    if (context[canonical] !== undefined && context[alias] === undefined) {
      context[alias] = context[canonical];
    }
  }

  // 4. Custom fields from contact
  if (contact?.customFields && typeof contact.customFields === 'object') {
    for (const [k, v] of Object.entries(contact.customFields)) {
      if (typeof v === 'string') {
        const cleanKey = k.trim().toLowerCase();
        context[cleanKey] = v;
        context[`custom.${cleanKey}`] = v;
      }
    }
  }

  // 5. Arbitrary extra key/values from lead root or caller
  if (lead) {
    for (const [k, v] of Object.entries(lead)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        const keyLower = k.toLowerCase();
        if (context[keyLower] === undefined) {
          context[keyLower] = String(v);
        }
      }
    }
  }

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') {
        context[k.toLowerCase()] = v;
      }
    }
  }

  return context;
}

/**
 * Regular expression matching merge tokens in three common syntaxes:
 * 1. {{.variable}} (Go-template style)
 * 2. {{variable}} (Handlebars/Mustache style)
 * 3. {variable} (Brace syntax)
 */
const TOKEN_REGEX = /(?:\{\{\.([a-zA-Z0-9_.-]+)\}\}|\{\{([a-zA-Z0-9_.-]+)\}\}|\{([a-zA-Z0-9_.-]+)\})/g;

/**
 * Replaces all recognized tokens in text with values from context.
 * Leaves unrecognized tokens intact if strict is false (default), or empties them if strict is true.
 */
export function interpolateTemplate(
  template: string,
  context: Record<string, string>,
  options?: { strict?: boolean }
): string {
  if (!template) return '';

  return template.replace(TOKEN_REGEX, (match, goToken, dblToken, sglToken) => {
    const rawToken = goToken || dblToken || sglToken;
    if (!rawToken) return match;

    const tokenLower = rawToken.trim().toLowerCase();
    const canonical = resolveCanonicalToken(tokenLower);

    if (context[canonical] !== undefined && context[canonical] !== '') {
      return context[canonical];
    }
    if (context[tokenLower] !== undefined && context[tokenLower] !== '') {
      return context[tokenLower];
    }

    // Fallback: if strict is true, missing values evaluate to empty string.
    // Otherwise keep original placeholder.
    return options?.strict ? '' : match;
  });
}

export type PersonalizationValidationResult = {
  valid: boolean;
  missingFields: string[];
};

export type TemplateWithRequirements = {
  subject?: string;
  body: string;
  required_fields?: string[];
  requiredFields?: string[];
  variables?: string[];
};

/**
 * Validates that all required fields for a template are present and non-empty in context.
 */
export function validatePersonalization(
  template: TemplateWithRequirements,
  context: Record<string, string>
): PersonalizationValidationResult {
  const reqSet = new Set<string>();

  if (Array.isArray(template.required_fields)) {
    template.required_fields.forEach((f) => {
      if (typeof f === 'string' && f.trim()) reqSet.add(f.trim());
    });
  }

  if (Array.isArray(template.requiredFields)) {
    template.requiredFields.forEach((f) => {
      if (typeof f === 'string' && f.trim()) reqSet.add(f.trim());
    });
  }

  const missing: string[] = [];

  for (const rawField of reqSet) {
    const canonical = resolveCanonicalToken(rawField);
    const value = context[canonical] ?? context[rawField.toLowerCase()];
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      missing.push(rawField);
    }
  }

  return {
    valid: missing.length === 0,
    missingFields: missing,
  };
}
