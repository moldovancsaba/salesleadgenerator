export type Brand = 'cogmap' | 'seyu';

// Generic, organization-agnostic value-proposition fields — shared across every
// brand/tenant. Not brand-specific: any organization onboarded onto this
// pipeline reads and writes these two field names.
export const PRO_FIELD = 'pro_for_organization';
export const CON_FIELD = 'con_for_organization';

// Single source of truth for currency codes this app actually uses (issue
// #145) — a real, named, extensible set (matching lib/lead-taxonomy.ts's
// controlled-vocabulary pattern), not "accept any string." Previously
// `'USD' | 'EUR'` was independently hardcoded in lib/ticket-size.ts,
// app/lib/sales-settings.ts, and app/lib/forecast.ts, with no shared
// definition — a new brand's currency required editing all three by hand and
// risked them silently drifting apart. Every other module now imports this
// type (or a re-export of it) instead of declaring its own union.
export type CurrencyCode = 'USD' | 'EUR';

export const CURRENCY_CODE_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

export const CURRENCY_CODES: CurrencyCode[] = CURRENCY_CODE_OPTIONS.map((o) => o.value);

export const BRAND_CONFIG: Record<string, {
  label: string;
  dbCollection: string;
  apiPrefix: string;
  // Each brand's own reporting/forecast currency — a property of the brand
  // itself, not inferred ad hoc by callers. No FX conversion exists anywhere
  // in this app (see lib/pipeline-coverage.ts's currency-mismatch handling);
  // this is purely which currency a brand's own figures are already in.
  currency: CurrencyCode;
}> = {
  cogmap: {
    label: 'CogMap',
    dbCollection: 'leads',
    apiPrefix: '/api/leads',
    currency: 'USD',
  },
  seyu: {
    label: 'Seyu',
    dbCollection: 'seyu_leads',
    apiPrefix: '/api/leads',
    currency: 'EUR',
  },
};

export function resolveBrand(value: string | undefined | null): Brand {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'cogmap' || normalized === 'cogmapsales') return 'cogmap';
  if (normalized === 'seyu' || normalized === 'seyusales') return 'seyu';
  return 'cogmap';
}
