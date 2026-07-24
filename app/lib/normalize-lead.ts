import { PRO_FIELD, CON_FIELD } from './brand';

export type LeadRaw = Record<string, any>;

type NormalizationWarnings = string[];

export interface NormalizedLead extends LeadRaw {
  _warnings?: NormalizationWarnings;
}

function sanitizeString(value: any, maxLength = 5000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function ensureString(value: any, maxLength = 5000): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return sanitizeString(value, maxLength);
}

// The shared guarantee that ICE fields become real, clamped numbers rather
// than passing through as numeric-looking strings — a caller that writes ICE
// values without routing them through this (as PUT /api/leads/[id] once did)
// risks the exact corruption class fixed in 2.4.8: a string operand silently
// breaks the Mongo aggregation that sorts DISCOVERED/QUALIFIED by score.
function ensureNumber(value: any, min = 0, max = 10): number {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(min, Math.min(max, num));
}

export function ensureArrayField(value: any): string[] {
  if (Array.isArray(value)) {
    const flat = value.flat(Infinity);
    if (!Array.isArray(flat)) return [];
    return flat
      .map((item) => ensureString(item))
      .filter((item) => item.length > 0);
  }

  if (value === null || value === undefined) return [];

  if (typeof value === 'number' || typeof value === 'boolean') {
    const str = String(value);
    return str.length > 0 ? [str] : [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  return [];
}

// ensureArrayField/ensureNumber below coerce bad input silently (an object
// becomes [], an out-of-range number gets clamped) with no way for the caller
// to know something was actually wrong. This surfaces exactly those two cases
// as warnings instead, which extractWarnings() later exposes to the caller.
function validateObject(value: any): string[] {
  const warnings: string[] = [];

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      warnings.push(`Object passed where string/array expected: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`);
    }
  }

  if (typeof value === 'number' && (value < 0 || value > 10)) {
    warnings.push(`Numeric value out of expected range: ${value}`);
  }

  return warnings;
}

export function normalizeLead(raw: LeadRaw): NormalizedLead {
  const warnings: NormalizationWarnings = [];

  if (!raw || typeof raw !== 'object') {
    warnings.push('Lead data is null or not an object');
    return {
      entity_name: '',
      region: 'NA',
      qualityStatus: 'DRAFT',
      contacts: [],
      tags: [],
      [PRO_FIELD]: [],
      [CON_FIELD]: [],
      _warnings: warnings,
    };
  }

  const proValue = raw[PRO_FIELD];
  const conValue = raw[CON_FIELD];

  warnings.push(...validateObject(proValue));
  warnings.push(...validateObject(conValue));

  const pro = ensureArrayField(proValue);
  const con = ensureArrayField(conValue);

  const VALID_KANBAN_COLUMNS = new Set([
    'DISCOVERED',
    'QUALIFIED',
    'ENGAGED',
    'PROPOSAL',
    'WON',
    'LOST',
  ]);

  const kanbanColumn = typeof raw.kanbanColumn === 'string' ? raw.kanbanColumn.trim().toUpperCase() : '';
  const normalizedColumn = kanbanColumn && VALID_KANBAN_COLUMNS.has(kanbanColumn) ? kanbanColumn : 'DISCOVERED';

  const normalized: NormalizedLead = {
    ...raw,
    [PRO_FIELD]: pro,
    [CON_FIELD]: con,
    qualityStatus: typeof raw.qualityStatus === 'string' ? raw.qualityStatus : 'DRAFT',
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    entity_name: ensureString(raw.entity_name || raw.name),
    region: ensureString(raw.region || 'NA').toUpperCase(),
    url: ensureString(raw.url),
    decision_maker_name: ensureString(raw.decision_maker_name),
    decision_maker_title: ensureString(raw.decision_maker_title),
    decision_maker_contact: ensureString(raw.decision_maker_contact),
    address: ensureString(raw.address),
    general_contact: ensureString(raw.general_contact),
    size: ensureString(raw.size),
    industry: ensureString(raw.industry || raw.sport_or_sector),
    value_proposition: ensureString(raw.value_proposition),
    notes: ensureString(raw.notes),
    kanbanColumn: normalizedColumn,
  };

  if (typeof raw.ice === 'object' && raw.ice !== null) {
    normalized.ice = {
      impact: ensureNumber(raw.ice.impact, 1, 10),
      confidence: ensureNumber(raw.ice.confidence, 1, 10),
      ease: ensureNumber(raw.ice.ease, 1, 10),
    };
  }

  if (warnings.length > 0) {
    normalized._warnings = warnings;
  }

  return normalized;
}

export function extractWarnings(lead: any): string[] {
  if (!lead || typeof lead !== 'object') return [];
  const warnings = lead._warnings;
  if (Array.isArray(warnings)) return warnings.filter((w: any) => typeof w === 'string');
  return [];
}
