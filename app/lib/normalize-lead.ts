export type LeadRaw = Record<string, any>;

export function normalizeLead(raw: LeadRaw, brand: string): LeadRaw {
  const proKey = `pro_for_${brand}`;
  const conKey = `con_for_${brand}`;
  const pro = ensureArrayField(raw[proKey]);
  const con = ensureArrayField(raw[conKey]);
  return {
    ...raw,
    [proKey]: pro,
    [conKey]: con,
    qualityStatus: raw.qualityStatus || 'DRAFT',
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

export function ensureArrayField(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}
