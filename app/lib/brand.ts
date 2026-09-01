import clientPromise, { isMongoConfigured } from '../../lib/mongodb';

// Issue #195 — brand/tenant configuration moved from a static object to a
// Mongo-backed registry so a site admin can add a client without a code
// deploy (issue #196). `Brand` was a 3-value compile-time literal union;
// a runtime-editable set of brands can't be one, so it's now just `string`.
// Compile-time exhaustiveness is replaced by the null-check every caller
// already had to do for an unrecognized brand.
export type Brand = string;

// Generic, organization-agnostic value-proposition fields — shared across every
// brand/tenant. Not brand-specific: any organization onboarded onto this
// pipeline reads and writes these two field names.
export const PRO_FIELD = 'pro_for_organization';
export const CON_FIELD = 'con_for_organization';

// Single source of truth for currency codes this app actually uses (issue
// #145) — a real, named, extensible set, not "accept any string."
export type CurrencyCode = 'USD' | 'EUR';

export const CURRENCY_CODE_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

export const CURRENCY_CODES: CurrencyCode[] = CURRENCY_CODE_OPTIONS.map((o) => o.value);

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
};

// 'dealSizeBand' — app/lib/forecast.ts's generic, fully data-driven forecast
// model (reads Lead.ticketSizeEstimate/deals/estimated_annual_revenue_usd —
// no brand-specific logic). Every new brand should default to this.
// 'custom' — a bespoke forecast model requiring its own hardcoded branch in
// forecast.ts (e.g. Seyu's pricingByCompany-shaped model) — inherently code,
// not something this registry can generalize. A brand flagged 'custom' with
// no matching branch simply gets forecast: null, same as today's behavior
// for any brand forecast.ts doesn't recognize.
export type ForecastModel = 'dealSizeBand' | 'custom';

export interface BrandSalesVocabulary {
  customerTypes: string[];
  buyerRoles: string[];
}

export interface BrandConfig {
  label: string;
  dbCollection: string;
  apiPrefix: string;
  currency: CurrencyCode;
  // Slugs/spellings this brand is reachable under (its own slug plus e.g. the
  // legacy `<slug>sales` SSO org-name convention). Unique across every brand.
  aliases: string[];
  // This brand's own name/spelling/distinctive-product vocabulary — terms
  // that must never leak into another brand's lead or battlecard content.
  // getForbiddenTermsFor() below unions every *other* brand's list to build
  // the actual forbidden set for a given brand, so this never needs manual
  // symmetric upkeep the way the old FORBIDDEN_BRAND_TERMS map did.
  ownNameTerms: string[];
  forecastModel: ForecastModel;
  // Optional per-brand extension of the universal customerType/buyerRole
  // enums (app/lib/sales-settings.ts) — omitted brands get the universal
  // base set only, never every brand's combined vocabulary.
  salesVocabulary?: BrandSalesVocabulary;
  // Replaces the RESEND_FROM_<BRAND> env var — omitted brands fall back to
  // lib/outreach-send.ts's own domain-based default, same as today.
  fromEmail?: string;
}

export interface BrandRecord extends BrandConfig {
  slug: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

const BRANDS_COLLECTION = 'brands';

// Issue #195 — retained ONLY as (a) seed data for
// scripts/migrate-brands-to-mongo.ts and (b) the value getAllBrandConfigs()
// returns when the `brands` collection is genuinely empty (a fresh
// environment before the migration script has run). Once `brands` holds at
// least one document, MongoDB is fully authoritative — a slug not found
// there is `null`, never silently patched from here. Never a second,
// coexisting source of truth once brands exist in Mongo.
//
// ownNameTerms below were reverse-derived from the pre-#195 hand-maintained
// FORBIDDEN_BRAND_TERMS map (lib/validate-lead.ts) by checking which terms
// each *other* brand's list attributed to a given brand — every one of
// CogMap's and Seyu's real forbidden-term entries is exactly reproduced by
// this derivation. DVSC's derived forbidden set comes out slightly larger
// than its old hand list, which was missing 'sports science',
// 'situational awareness', 'jumbotron', 'sponsor activation', 'revenue-share'
// and 'revenue share' — a real, pre-existing asymmetry the old map's own
// comment already flagged as unintentional ("DVSC's own list borrows CogMap's/
// Seyu's already-vetted terms... not a DVSC-specific vocabulary of its own
// yet"). This derivation fixes that gap rather than preserving it.
// Issue #146's brand-scoped CustomerType/BuyerRole vocabulary (a universal
// base set every brand shares, plus each brand's own extension) — see
// app/lib/sales-settings.ts's CUSTOMER_TYPE_BASE/BUYER_ROLE_BASE for the
// base set these extend. CogMap keeps its full original sport-specific set;
// Seyu (fan engagement, not sport-specific buyer roles) and DVSC (sponsor
// companies, already fully covered by the universal base set per issue
// #148) get progressively narrower extensions — carried over unchanged
// from the pre-#195 static BRAND_SALES_VOCABULARY map.
const SPORT_SPECIFIC_CUSTOMER_TYPES = ['sports_clubs', 'federations', 'schools', 'academies', 'event_organisers'];
const SPORT_SPECIFIC_BUYER_ROLES = ['coach', 'federation', 'club', 'parent', 'athlete'];

export const FALLBACK_BRAND_CONFIG: Record<string, BrandConfig> = {
  cogmap: {
    label: 'CogMap',
    dbCollection: 'leads',
    apiPrefix: '/api/leads',
    currency: 'USD',
    aliases: ['cogmap', 'cogmapsales'],
    ownNameTerms: ['cogmap', 'cognitive assessment', 'player performance analytics', 'decision-making profiling', 'sports science', 'situational awareness'],
    forecastModel: 'dealSizeBand',
    salesVocabulary: { customerTypes: SPORT_SPECIFIC_CUSTOMER_TYPES, buyerRoles: SPORT_SPECIFIC_BUYER_ROLES },
  },
  seyu: {
    label: 'Seyu',
    dbCollection: 'seyu_leads',
    apiPrefix: '/api/leads',
    currency: 'EUR',
    aliases: ['seyu', 'seyusales'],
    ownNameTerms: ['seyu', 'fan selfie', 'led screen', 'jumbotron', 'sponsor activation', 'revenue-share', 'revenue share', 'second screen', 'second-screen'],
    forecastModel: 'custom',
    salesVocabulary: { customerTypes: SPORT_SPECIFIC_CUSTOMER_TYPES, buyerRoles: [] },
  },
  dvsc: {
    label: 'DVSC',
    dbCollection: 'dvsc_leads',
    apiPrefix: '/api/leads',
    currency: 'EUR',
    aliases: ['dvsc', 'dvscsales'],
    ownNameTerms: ['dvsc'],
    salesVocabulary: { customerTypes: [], buyerRoles: [] },
    forecastModel: 'dealSizeBand',
  },
};

// Deliberately reads clientPromise itself rather than taking a `db: Db`
// parameter (unlike e.g. lib/pipeline-weights.ts's getPipelineWeights) —
// brand config is resolved on nearly every request, including many call
// sites (route-matching in a Server Component, resolveBrand() before any
// other DB work) that today do no DB work at all just to look up a brand.
// Requiring every caller to first open a `db` handle would be a much bigger
// diff than the "add await" this migration is meant to be, and would open a
// Mongo connection eagerly in places that currently don't need one.
async function loadAllBrandDocs(): Promise<BrandRecord[] | null> {
  if (!isMongoConfigured()) return null;
  try {
    const client = await clientPromise;
    const db = client.db();
    return await db.collection<BrandRecord>(BRANDS_COLLECTION).find({}).toArray();
  } catch {
    return null;
  }
}

let indexesEnsured = false;
// Idempotent, lazy-ensured — same pattern as app/lib/forecast-snapshot.ts's
// own indexesEnsured flag. Unique on `slug`; unique multikey on `aliases`
// (each brand's own slug is included in its own aliases array, so a new
// brand's alias can never collide with an existing brand's slug either).
async function ensureBrandIndexes(): Promise<void> {
  if (indexesEnsured || !isMongoConfigured()) return;
  try {
    const client = await clientPromise;
    const db = client.db();
    await db.collection(BRANDS_COLLECTION).createIndex({ slug: 1 }, { unique: true });
    await db.collection(BRANDS_COLLECTION).createIndex({ aliases: 1 }, { unique: true });
    indexesEnsured = true;
  } catch {
    // Best-effort — a transient failure here just means the next call retries.
  }
}

export async function getAllBrandConfigs(): Promise<Record<string, BrandConfig>> {
  const docs = await loadAllBrandDocs();
  if (!docs || docs.length === 0) return FALLBACK_BRAND_CONFIG;
  const result: Record<string, BrandConfig> = {};
  for (const { slug, createdAt, createdBy, updatedAt, ...config } of docs) {
    result[slug] = config;
  }
  return result;
}

export async function getBrandConfig(slug: string): Promise<BrandConfig | null> {
  const all = await getAllBrandConfigs();
  return all[slug] ?? null;
}

// Issue #147's own resolveBrand contract, preserved exactly: an empty/missing
// value (no brand specified at all) still resolves to 'cogmap' — every
// existing caller either supplies a real dynamic-route brand segment (never
// empty) or explicitly relies on this default for a legitimate
// no-brand-specified request. A genuinely unrecognized, non-empty value
// returns `null` (not a guessed brand) — callers handle that explicitly
// (404/400), same as before.
export async function resolveBrand(value: string | undefined | null): Promise<Brand | null> {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return 'cogmap';
  const all = await getAllBrandConfigs();
  for (const [slug, config] of Object.entries(all)) {
    if (config.aliases.includes(normalized)) return slug;
  }
  return null;
}

// The derived replacement for the old hand-maintained, must-stay-symmetric
// FORBIDDEN_BRAND_TERMS map (lib/validate-lead.ts) — the forbidden set for
// `brand` is simply the union of every *other* brand's own ownNameTerms.
// Adding a brand here automatically and correctly extends every existing
// brand's protection with zero manual list edits.
export async function getForbiddenTermsFor(brand: string): Promise<string[]> {
  const normalized = String(brand || '').toLowerCase();
  const all = await getAllBrandConfigs();
  const terms = new Set<string>();
  for (const [slug, config] of Object.entries(all)) {
    if (slug === normalized) continue;
    for (const term of config.ownNameTerms) terms.add(term);
  }
  return Array.from(terms);
}

export async function createBrand(record: BrandRecord): Promise<void> {
  await ensureBrandIndexes();
  const client = await clientPromise;
  const db = client.db();
  await db.collection<BrandRecord>(BRANDS_COLLECTION).insertOne(record);
}
