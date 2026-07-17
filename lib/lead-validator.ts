/**
 * Lead pre-POST validation + normalization for the research agent.
 */

export interface LeadDraft {
  entity_name?: string;
  name?: string;
  url?: string;
  region?: string;
  country?: string;
  ice?: { impact?: number; confidence?: number; ease?: number };
  impact?: number;
  confidence?: number;
  ease?: number;
  contacts?: any[];
  pro_for_cogmap?: any[];
  con_for_cogmap?: any[];
  pro_for_seyu?: any[];
  con_for_seyu?: any[];
  decision_maker_contact?: string;
  contact_phone?: string;
  address?: string;
  [key: string]: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  normalized?: LeadDraft;
}

function ensureStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim().length > 0)
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
  return []
}

function ensureContactArray(value: any): any[] {
  if (!Array.isArray(value)) return []
  return value.map((contact) => ({
    name: typeof contact?.name === 'string' ? contact.name.trim() : '',
    title: typeof contact?.title === 'string' ? contact.title.trim() : '',
    email: typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '',
    phone: typeof contact?.phone === 'string' ? contact.phone.trim() : '',
  }))
}

export function validateAndNormalizeLeadDraft(draft: LeadDraft): ValidationResult {
  const errors: string[] = []
  const normalized: LeadDraft = { ...draft }

  const entityName = (normalized.entity_name || normalized.name || '').trim()
  if (!entityName) errors.push('entity_name is required')
  normalized.entity_name = entityName || normalized.entity_name

  const url = (normalized.url || '').trim()
  if (!url) errors.push('url is required')
  normalized.url = url

  const region = (normalized.region || 'US').trim().toUpperCase()
  if (!region) errors.push('region is required')
  normalized.region = region || 'US'

  const country = (normalized.country || region || 'US').trim().toUpperCase()
  normalized.country = country

  const impact = Number(normalized.ice?.impact ?? normalized.impact ?? 0)
  const confidence = Number(normalized.ice?.confidence ?? normalized.confidence ?? 0)
  const ease = Number(normalized.ice?.ease ?? normalized.ease ?? 0)

  if (!Number.isFinite(impact) || impact < 1 || impact > 10) errors.push('ice.impact must be 1-10')
  if (!Number.isFinite(confidence) || confidence < 1 || confidence > 10) errors.push('ice.confidence must be 1-10')
  if (!Number.isFinite(ease) || ease < 1 || ease > 10) errors.push('ice.ease must be 1-10')

  normalized.ice = {
    impact: Number.isFinite(impact) ? Math.max(1, Math.min(10, impact)) : 5,
    confidence: Number.isFinite(confidence) ? Math.max(1, Math.min(10, confidence)) : 5,
    ease: Number.isFinite(ease) ? Math.max(1, Math.min(10, ease)) : 5,
  }
  delete normalized.impact
  delete normalized.confidence
  delete normalized.ease

  if (normalized.decision_maker_contact && typeof normalized.decision_maker_contact === 'string') {
    normalized.decision_maker_contact = normalized.decision_maker_contact.toLowerCase().trim()
  }
  if (normalized.contact_phone && typeof normalized.contact_phone === 'string') {
    const cleaned = normalized.contact_phone.replace(/[^\d+]/g, '')
    normalized.contact_phone = cleaned.startsWith('+') ? cleaned : `+${cleaned}`
  }
  if (normalized.address && typeof normalized.address === 'string') {
    normalized.address = normalized.address.trim()
  }

  normalized.contacts = ensureContactArray(normalized.contacts)

  for (const brand of ['cogmap', 'seyu'] as const) {
    const proField = `pro_for_${brand}`
    const conField = `con_for_${brand}`
    if (normalized[proField] !== undefined) normalized[proField] = ensureStringArray(normalized[proField])
    if (normalized[conField] !== undefined) normalized[conField] = ensureStringArray(normalized[conField])
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? normalized : undefined,
  }
}
