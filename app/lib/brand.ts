export type Brand = 'cogmap' | 'seyu';

export const BRAND_CONFIG: Record<Brand, {
  label: string;
  dbCollection: string;
  proField: string;
  conField: string;
  apiPrefix: string;
}> = {
  cogmap: {
    label: 'CogMap',
    dbCollection: 'leads',
    proField: 'pro_for_cogmap',
    conField: 'con_for_cogmap',
    apiPrefix: '/api/leads',
  },
  seyu: {
    label: 'Seyu',
    dbCollection: 'seyu_leads',
    proField: 'pro_for_seyu',
    conField: 'con_for_seyu',
    apiPrefix: '/api/leads',
  },
};

export function resolveBrand(value: string | undefined | null): Brand {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'cogmap' || normalized === 'cogmapsales') return 'cogmap';
  if (normalized === 'seyu' || normalized === 'seyusales') return 'seyu';
  return 'cogmap';
}
