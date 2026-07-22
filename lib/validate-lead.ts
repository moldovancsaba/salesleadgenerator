export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[\d][\d\-\s]{7,}$/;
const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\/\S+$/i;
const CONTACT_CONFIDENCE_RE = /[A-Za-z]{2,}/;

const KANBAN_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
const KANBAN_COLUMN_SET = new Set(KANBAN_COLUMNS);
const PATCH_ACTIONS = new Set(['ACCEPT', 'DECLINE', 'MODIFY', 'PIN', 'REQUEST_REFRESH', 'COLUMN_MOVE']);

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

  // Brand-field separation enforcement — always applies, create or update.
  const brandUpper = String(brand || '').toUpperCase();
  const forbiddenBrandFields: Record<string, string[]> = {
    COGMAP: ['pro_for_seyu', 'con_for_seyu'],
    SEYU: ['pro_for_cogmap', 'con_for_cogmap'],
  };

  const forbiddenFields = forbiddenBrandFields[brandUpper] || [];
  for (const field of forbiddenFields) {
    if (body[field] !== undefined) {
      errors.push(`Forbidden field for brand ${brand}: ${field}`);
    }
  }

  const vp = typeof body.value_proposition === 'string' ? body.value_proposition.toLowerCase() : '';
  const forbiddenValueTerms: Record<string, string[]> = {
    COGMAP: ['seyu', 'fan selfie', 'led screen', 'jumbotron', 'sponsor activation', 'revenue-share', 'revenue share', 'second screen', 'second-screen'],
    SEYU: ['cogmap', 'cognitive assessment', 'player performance analytics', 'decision-making profiling', 'sports science', 'situational awareness'],
  };

  const valueTerms = forbiddenValueTerms[brandUpper] || [];
  for (const term of valueTerms) {
    if (vp.includes(term)) {
      errors.push(`value_proposition contains forbidden ${brand} content: ${term}`);
    }
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

  const proField = `pro_for_${brand}`;
  const conField = `con_for_${brand}`;

  if (body[proField] !== undefined && (!Array.isArray(body[proField]) || !body[proField].every((item: any) => typeof item === 'string'))) {
    errors.push(`${proField} must be an array of strings`);
  }

  if (body[conField] !== undefined && (!Array.isArray(body[conField]) || !body[conField].every((item: any) => typeof item === 'string'))) {
    errors.push(`${conField} must be an array of strings`);
  }

  if (body.decision_maker_contact && typeof body.decision_maker_contact === 'string' && body.decision_maker_contact !== body.decision_maker_contact.toLowerCase().trim()) {
    errors.push('decision_maker_contact must be lowercase');
  }

  if (body.contact_phone && typeof body.contact_phone === 'string' && !PHONE_RE.test(body.contact_phone.trim())) {
    errors.push('contact_phone must be in international format starting with +');
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
    errors.push('action must be one of: ACCEPT, DECLINE, MODIFY, PIN, REQUEST_REFRESH, COLUMN_MOVE');
    return { valid: false, errors };
  }

  if (action === 'MODIFY') {
    const result = validateLeadPayload(body, brand);
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
