export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[\d][\d\-\s]{7,}$/;

const KANBAN_COLUMNS = new Set(['DRAFT', 'LIVE', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST', 'QUALIFIED', 'DISCOVERED']);
const PATCH_ACTIONS = new Set(['ACCEPT', 'DECLINE', 'MODIFY', 'PIN', 'REQUEST_REFRESH', 'COLUMN_MOVE']);

export function validateLeadPayload(body: any, brand: string): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Invalid payload'] };
  }

  // Brand-field separation enforcement
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

  if (!body.entity_name || typeof body.entity_name !== 'string' || !body.entity_name.trim()) {
    errors.push('entity_name is required');
  }

  if (!body.url || typeof body.url !== 'string' || !URL_RE.test(body.url.trim())) {
    errors.push('url must be a valid HTTP(S) URL');
  }

  if (!body.country || typeof body.country !== 'string' || !ISO_COUNTRY_RE.test(body.country)) {
    errors.push('country must be a 2-letter ISO code');
  }

  const kanbanColumn = body.kanbanColumn;
  if (!kanbanColumn || typeof kanbanColumn !== 'string' || !KANBAN_COLUMNS.has(kanbanColumn.toUpperCase())) {
    errors.push('kanbanColumn must be one of: DRAFT, LIVE, ENGAGED, PROPOSAL, WON, LOST, QUALIFIED, DISCOVERED');
  }

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

  if (kanbanColumn && ['LIVE', 'ENGAGED'].includes(String(kanbanColumn).toUpperCase())) {
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      errors.push('contacts array is required for LIVE/ENGAGED leads');
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
    if (!kanbanColumn || typeof kanbanColumn !== 'string' || !KANBAN_COLUMNS.has(kanbanColumn.toUpperCase())) {
      errors.push('kanbanColumn must be one of: DRAFT, LIVE, ENGAGED, PROPOSAL, WON, LOST, QUALIFIED, DISCOVERED');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
