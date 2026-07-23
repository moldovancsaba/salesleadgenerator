export type Brand = 'cogmap' | 'seyu';

// Generic, organization-agnostic value-proposition fields — shared across every
// brand/tenant. Not brand-specific: any organization onboarded onto this
// pipeline reads and writes these two field names.
export const PRO_FIELD = 'pro_for_organization';
export const CON_FIELD = 'con_for_organization';

export const BRAND_CONFIG: Record<string, {
  label: string;
  dbCollection: string;
  apiPrefix: string;
}> = {
  cogmap: {
    label: 'CogMap',
    dbCollection: 'leads',
    apiPrefix: '/api/leads',
  },
  seyu: {
    label: 'Seyu',
    dbCollection: 'seyu_leads',
    apiPrefix: '/api/leads',
  },
};

export function resolveBrand(value: string | undefined | null): Brand {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'cogmap' || normalized === 'cogmapsales') return 'cogmap';
  if (normalized === 'seyu' || normalized === 'seyusales') return 'seyu';
  return 'cogmap';
}
