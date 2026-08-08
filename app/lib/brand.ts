export type Brand = 'cogmap' | 'seyu' | 'dvsc';

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

// Display symbol per currency code — issue #170. Single source of truth so a
// brand-aware label/price display never has to hardcode a symbol itself.
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
};

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
  dvsc: {
    label: 'DVSC',
    dbCollection: 'dvsc_leads',
    apiPrefix: '/api/leads',
    currency: 'EUR',
  },
};

// Aliases accepted alongside a brand's own BRAND_CONFIG key (e.g. the legacy
// SSO org-name convention "<brand>sales") — kept as an explicit map rather
// than a string-suffix guess, so a brand with no alias simply has none here.
const BRAND_ALIASES: Record<string, Brand> = {
  cogmap: 'cogmap',
  cogmapsales: 'cogmap',
  seyu: 'seyu',
  seyusales: 'seyu',
  dvsc: 'dvsc',
  dvscsales: 'dvsc',
};

// Issue #147 — previously hardcoded exactly 2 string checks with an
// `else -> 'cogmap'` fallback: ANY unrecognized value (a typo, a stale
// bookmark, a not-yet-configured brand) silently resolved to CogMap,
// causing silent wrong-brand reads/writes rather than a visible error. Now
// derived from BRAND_ALIASES (so a future brand needs no change here) and
// returns `null` — not a guessed brand — for a genuinely unrecognized,
// non-empty value; callers must handle that explicitly (404/400), the same
// way they'd handle any other not-found route param. An empty/missing value
// (no brand specified at all, distinct from an invalid one) still resolves
// to 'cogmap', unchanged — every existing caller either supplies a real
// dynamic-route brand segment (never empty) or explicitly relies on this
// default for a legitimate no-brand-specified request.
export function resolveBrand(value: string | undefined | null): Brand | null {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return 'cogmap';
  return BRAND_ALIASES[normalized] ?? null;
}
