import { PRO_FIELD, CON_FIELD } from '../app/lib/brand';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;
// Exported so lib/email-verification.ts's verifyEmail() runs the identical
// format check before ever attempting an MX lookup (issue #67) — one
// source of truth, not a second regex that could drift from this one.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[\d][\d\-\s]{7,}$/;
const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\/\S+$/i;
const CONTACT_CONFIDENCE_RE = /[A-Za-z]{2,}/;

// Shared with app/api/battlecards/route.ts's own content validation (issue
// #65) — one source of truth for which terms belong to which brand, rather
// than a second copy that could drift from this one.
export const FORBIDDEN_BRAND_TERMS: Record<string, string[]> = {
  COGMAP: ['seyu', 'fan selfie', 'led screen', 'jumbotron', 'sponsor activation', 'revenue-share', 'revenue share', 'second screen', 'second-screen'],
  SEYU: ['cogmap', 'cognitive assessment', 'player performance analytics', 'decision-making profiling', 'sports science', 'situational awareness'],
};

export function findForbiddenBrandTerms(text: string | undefined | null, brand: string): string[] {
  const brandUpper = String(brand || '').toUpperCase();
  const lower = typeof text === 'string' ? text.toLowerCase() : '';
  const terms = FORBIDDEN_BRAND_TERMS[brandUpper] || [];
  return terms.filter((term) => lower.includes(term));
}

// BACKLOG (issue #126) included here so COLUMN_MOVE into/out of it validates
// normally — it's excluded from app/constants.ts's own COLUMNS (the
// Pipeline board's rendered/auto-managed set), not from this general
// validity check.
const KANBAN_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST', 'BACKLOG'];
const KANBAN_COLUMN_SET = new Set(KANBAN_COLUMNS);
const ORG_SIZES = ['Small', 'Medium', 'Large', 'Enterprise'];
const ORG_SIZE_SET = new Set(ORG_SIZES);
const PATCH_ACTIONS = new Set(['ACCEPT', 'DECLINE', 'MODIFY', 'PIN', 'REQUEST_REFRESH', 'COLUMN_MOVE', 'RESCAN_TECH']);

function contactConfidence(contact: any): number {
  if (!contact || typeof contact !== 'object') return 0;
  let score = 0;
  if (typeof contact.name === 'string' && CONTACT_CONFIDENCE_RE.test(contact.name)) score += 2;
  if (typeof contact.title === 'string' && contact.title.trim().length > 1) score += 2;
  if (typeof contact.email === 'string' && EMAIL_RE.test(contact.email)) score += 3;
  if (typeof contact.phone === 'string' && PHONE_RE.test(contact.phone)) score += 2;
  if (typeof contact.linkedin === 'string' && LINKEDIN_RE.test(contact.linkedin)) score += 1;
  return Math.min(10, score);
}

export function bestContactConfidence(contacts: any[]): number {
  if (!Array.isArray(contacts) || contacts.length === 0) return 0;
  return Math.max(...contacts.map(contactConfidence));
}

export function validateLeadPayload(body: any, brand: string, options?: { partial?: boolean }): ValidationResult {
  const errors: string[] = [];
  const partial = options?.partial === true;

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Invalid payload'] };
  }

  for (const term of findForbiddenBrandTerms(body.value_proposition, brand)) {
    errors.push(`value_proposition contains forbidden ${brand} content: ${term}`);
  }

  // entity_name / url / country / kanbanColumn / ice: required on create (partial=false);
  // on a partial update (partial=true) they're only validated for FORMAT if present at all.
  if (!partial || body.entity_name !== undefined) {
    if (!body.entity_name || typeof body.entity_name !== 'string' || !body.entity_name.trim()) {
      errors.push('entity_name is required');
    }
  }

  if (!partial || body.url !== undefined) {
    if (!body.url || typeof body.url !== 'string' || !URL_RE.test(body.url.trim())) {
      errors.push('url must be a valid HTTP(S) URL');
    }
  }

  if (!partial || body.country !== undefined) {
    if (!body.country || typeof body.country !== 'string' || !ISO_COUNTRY_RE.test(body.country)) {
      errors.push('country must be a 2-letter ISO code');
    }
  }

  if (!partial || body.kanbanColumn !== undefined) {
    const kanbanColumn = body.kanbanColumn;
    if (!kanbanColumn || typeof kanbanColumn !== 'string' || !KANBAN_COLUMN_SET.has(kanbanColumn.toUpperCase())) {
      errors.push('kanbanColumn must be one of: ' + KANBAN_COLUMNS.join(', '));
    }
  }

  if (!partial || body.ice !== undefined) {
    const ice = body.ice;
    if (!ice || typeof ice !== 'object') {
      errors.push('ice object is required');
    } else {
      const impact = Number(ice.impact);
      const confidence = Number(ice.confidence);
      const ease = Number(ice.ease);

      if (!Number.isFinite(impact) || impact < 1 || impact > 10) {
        errors.push('ice.impact must be a number between 1 and 10');
      }
      if (!Number.isFinite(confidence) || confidence < 1 || confidence > 10) {
        errors.push('ice.confidence must be a number between 1 and 10');
      }
      if (!Number.isFinite(ease) || ease < 1 || ease > 10) {
        errors.push('ice.ease must be a number between 1 and 10');
      }

      const expectedScore = impact * confidence * ease;
      if (Number.isFinite(expectedScore) && body.iceScore != null && Number(body.iceScore) !== expectedScore) {
        errors.push(`iceScore must equal impact×confidence×ease (${expectedScore})`);
      }
    }
  }

  if (body[PRO_FIELD] !== undefined && (!Array.isArray(body[PRO_FIELD]) || !body[PRO_FIELD].every((item: any) => typeof item === 'string'))) {
    errors.push(`${PRO_FIELD} must be an array of strings`);
  }

  if (body[CON_FIELD] !== undefined && (!Array.isArray(body[CON_FIELD]) || !body[CON_FIELD].every((item: any) => typeof item === 'string'))) {
    errors.push(`${CON_FIELD} must be an array of strings`);
  }

  // Not required — format-checked only when present, not mandated. The documented
  // schema names a fixed 4-tier enum, but nothing enforced it at the write boundary,
  // letting free text like "Pan-European league" (a scope description, not a size
  // tier) get stored as-is.
  if (body.size !== undefined && body.size !== null && body.size !== '') {
    if (typeof body.size !== 'string' || !ORG_SIZE_SET.has(body.size)) {
      errors.push('size must be one of: ' + ORG_SIZES.join(', '));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePatchPayload(body: any, brand: string): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Invalid payload'] };
  }

  const action = body.action;
  if (!action || typeof action !== 'string' || !PATCH_ACTIONS.has(action.toUpperCase())) {
    errors.push('action must be one of: ACCEPT, DECLINE, MODIFY, PIN, REQUEST_REFRESH, COLUMN_MOVE, RESCAN_TECH');
    return { valid: false, errors };
  }

  if (action === 'MODIFY') {
    // partial: true — a MODIFY is an edit to some of a lead's fields, not a
    // re-creation of the whole lead; without this, validateLeadPayload's
    // create-mode required-field checks (entity_name/url/country/kanbanColumn/
    // ice) reject every real MODIFY payload the app actually sends, since
    // none of them resend fields the edit didn't touch. Confirmed this was
    // breaking Edit Lead Details, actual-deal-value capture, and the manual
    // ticket-size-override clear — every one of those payloads 400'd before
    // reaching executeLeadAction's actual field-update logic.
    const result = validateLeadPayload(body, brand, { partial: true });
    if (!result.valid) {
      return result;
    }
  }

  if (action === 'COLUMN_MOVE') {
    const kanbanColumn = body.kanbanColumn;
    if (!kanbanColumn || typeof kanbanColumn !== 'string' || !KANBAN_COLUMN_SET.has(kanbanColumn.toUpperCase())) {
      errors.push('kanbanColumn must be one of: ' + KANBAN_COLUMNS.join(', '));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
