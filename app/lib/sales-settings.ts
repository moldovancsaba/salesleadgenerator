// Company Setup / Sales Settings — a plain-language questionnaire capturing
// what a brand sells, who buys it, and how it's priced, so the OpenClaw/
// KiloClaw research agent (a separate app; its own runtime config no longer
// lives in this repo, see issue #99) can refine lead scoring and
// forecasts. Deliberately avoids financial/accounting terms (ACV, ARR, MRR)
// in favor of the way a founder or small commercial team already thinks
// about their business — see GitHub issue #24 for the full rationale.

import { CURRENCY_CODES, CURRENCY_CODE_OPTIONS } from './brand';
import type { CurrencyCode, BrandSalesVocabulary } from './brand';

export type CustomerType =
  | 'sports_clubs'
  | 'federations'
  | 'schools'
  | 'academies'
  | 'event_organisers'
  | 'sponsors'
  | 'brands'
  | 'government'
  | 'other';

export type BuyerRole =
  | 'ceo'
  | 'marketing'
  | 'commercial'
  | 'coach'
  | 'federation'
  | 'club'
  | 'brand'
  | 'parent'
  | 'athlete'
  | 'other';

export type CustomerSize = 'individual' | 'small' | 'medium' | 'large' | 'enterprise';

export type PricingModel =
  | 'one_time'
  | 'monthly_subscription'
  | 'annual_subscription'
  | 'framework_agreement'
  | 'campaign_based'
  | 'per_user'
  | 'per_product'
  | 'per_event'
  | 'custom_quotation';

export type PurchaseFrequency =
  | 'once'
  | 'monthly'
  | 'yearly'
  | 'per_season'
  | 'per_event'
  | 'irregular';

export type SalesCycleLength =
  | 'under_1_month'
  | '1_3_months'
  | '3_6_months'
  | '6_12_months'
  | 'over_12_months';

export type RevenuePredictability = 'very_predictable' | 'predictable' | 'medium' | 'difficult';

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface ProductPricing {
  oneTimePrice?: number;
  monthlyPrice?: number;
  annualPrice?: number;
  frameworkAnnualValue?: number;
  campaignPrice?: number;
  campaignDurationMonths?: number;
  perUserPrice?: number;
  perUserMinimum?: number;
  perUserTypical?: number;
  perProductPrice?: number;
  perEventPrice?: number;
  customQuotationTypicalValue?: number;
}

export interface ProductLine {
  id: string;
  name: string;
  description: string;
  whyTheyBuy: string;
  typicalBuyer: BuyerRole[];
  typicalBuyerOther: string;
  customerSize: CustomerSize[];
  pricingModels: PricingModel[];
  pricing: ProductPricing;
  revenuePredictability: RevenuePredictability | '';
}

export interface DealSize {
  small?: number;
  medium?: number;
  large?: number;
  // Added in issue #79 — Lead.size has always had 4 tiers (Small/Medium/
  // Large/Enterprise, see lib/validate-lead.ts's ORG_SIZE_SET) but this
  // interface only ever defined bands for 3 of them, leaving no configured
  // band for an Enterprise-tier lead's ticket-size estimate to resolve
  // against. Real schema fix, not a workaround.
  enterprise?: number;
  largestWon?: number;
}

// Region is genuinely free text at the API boundary (Lead.region has no
// server-side enum — see lib/validate-lead.ts; app/lib/normalize-lead.ts
// just uppercases whatever string is given, defaulting to 'NA' when absent).
// This is therefore a sparse, operator-populated map, not a fixed-field
// form like DealSize: a region with no entry here is a deliberate 1.0 no-op
// in lib/ticket-size.ts, never an error or a fabricated adjustment (issue #84).
export type RegionMultipliers = Record<string, number>;

export interface Upsell {
  commonAdditionalProducts: string;
  typicalValue?: number;
}

export interface ExampleCustomer {
  name: string;
  productsPurchased: string;
  totalContractValue?: number;
  contractLength: string;
}

export interface Seasonality {
  quarters: Quarter[];
  specificMonths: string;
}

// Issue #145 — re-exported from app/lib/brand.ts's single currency source of
// truth rather than an independent 'USD' | 'EUR' union.
export type RevenueTargetCurrency = CurrencyCode;
export type RevenueTargetPeriod = 'monthly' | 'quarterly' | 'annual';

// Pipeline coverage ratio (issue #60) reads this against the brand's own
// weighted forecast — currency is explicit and user-set, never auto-detected
// or auto-converted (no FX rate source exists in this app).
export interface RevenueTarget {
  amount?: number;
  currency: RevenueTargetCurrency;
  period: RevenueTargetPeriod;
}

export interface SalesSettings {
  brand: string;
  tenantId: string;
  companyName: string;
  contactPerson: string;
  website: string;
  mainIndustry: string;
  customerTypes: CustomerType[];
  customerTypesOther: string;
  products: ProductLine[];
  dealSize: DealSize;
  regionMultipliers: RegionMultipliers;
  purchaseFrequency: PurchaseFrequency[];
  purchaseFrequencyComments: string;
  upsell: Upsell;
  salesCycle: SalesCycleLength | '';
  approver: string;
  exampleCustomer: ExampleCustomer;
  seasonality: Seasonality;
  notes: string;
  revenueTarget: RevenueTarget;
  updatedAt?: string;
}

export function emptyProductLine(id: string): ProductLine {
  return {
    id,
    name: '',
    description: '',
    whyTheyBuy: '',
    typicalBuyer: [],
    typicalBuyerOther: '',
    customerSize: [],
    pricingModels: [],
    pricing: {},
    revenuePredictability: '',
  };
}

// Issue #195 — no longer looks brand config up itself (that requires an
// async Mongo read this function's own callers can't always afford — see
// the module header): the caller resolves the brand's real currency (via
// app/lib/brand.ts's getBrandConfig()) and passes it in. Falls back to
// 'USD' when the brand/currency isn't known yet (e.g. the client-side
// initial useState() before the server round-trip has resolved it) —
// never throws, this is called from paths that must always return a value.
export function defaultRevenueTargetCurrency(currency?: RevenueTargetCurrency): RevenueTargetCurrency {
  return currency ?? 'USD';
}

export function emptySalesSettings(brand: string, tenantId = 'default', currency?: RevenueTargetCurrency): SalesSettings {
  return {
    brand,
    tenantId,
    companyName: '',
    contactPerson: '',
    website: '',
    mainIndustry: '',
    customerTypes: [],
    customerTypesOther: '',
    products: [],
    dealSize: {},
    regionMultipliers: {},
    purchaseFrequency: [],
    purchaseFrequencyComments: '',
    upsell: { commonAdditionalProducts: '' },
    salesCycle: '',
    approver: '',
    exampleCustomer: { name: '', productsPurchased: '', contractLength: '' },
    seasonality: { quarters: [], specificMonths: '' },
    notes: '',
    revenueTarget: { currency: defaultRevenueTargetCurrency(currency), period: 'annual' },
  };
}

// Issue #146 — CustomerType/BuyerRole are brand-scoped: a small, genuinely
// universal base set every brand shares, plus each brand's own extension of
// business-specific values. Confirmed real mismatch, not a guess: BuyerRole's
// 'coach'/'federation'/'club'/'parent'/'athlete' fit CogMap's own product
// (coaches assessing athletes at clubs/federations) but have no place in
// Seyu's real business — fan engagement services, sold to marketing/
// commercial/CEO buyers, never coaches or athletes. CogMap keeps its full
// current set unchanged (zero behavior change); Seyu's extension is empty,
// so its form now only shows the universal base roles.
//
// CustomerType's own per-brand split is deliberately left unnarrowed for
// Seyu (unlike BuyerRole): no equivalently confirmed real mismatch exists
// for CustomerType today, and CLAUDE.md Rule 5 forbids narrowing it from an
// unconfirmed business-logic guess. Both brands currently get the same
// CustomerType extension (the full sport-specific set) — the mechanism below
// is brand-ready so a future confirmed finding (or a new brand) can narrow
// it later without another architecture change.
const CUSTOMER_TYPE_BASE: CustomerType[] = ['sponsors', 'brands', 'government', 'other'];
const CUSTOMER_TYPE_SPORT_SPECIFIC: CustomerType[] = ['sports_clubs', 'federations', 'schools', 'academies', 'event_organisers'];
const BUYER_ROLE_BASE: BuyerRole[] = ['ceo', 'marketing', 'commercial', 'brand', 'other'];
const BUYER_ROLE_SPORT_SPECIFIC: BuyerRole[] = ['coach', 'federation', 'club', 'parent', 'athlete'];

// Issue #148's DVSC decision (DVSC sells sponsorship inventory; its real
// customers/buyer personas are already fully covered by the universal base
// sets, so its own vocabulary extension is empty) now lives as an explicit
// empty `salesVocabulary` on DVSC's brand record (app/lib/brand.ts) rather
// than a hardcoded case here.
//
// Issue #195 — BRAND_SALES_VOCABULARY moved to each brand's own record
// (app/lib/brand.ts's BrandConfig.salesVocabulary), read via an async
// Mongo lookup this module's own callers can't always afford (see the
// module header). The caller resolves the brand's vocabulary once (via
// getBrandConfig()) and passes it in here; omitted/undefined falls back to
// the universal base set only, never crashes and never shows every brand's
// combined vocabulary — same safe-fallback contract as before.
//
// The `as CustomerType[]`/`as BuyerRole[]` casts below are a deliberate
// boundary cast: app/lib/brand.ts's BrandSalesVocabulary is typed with
// plain `string[]` (it's a lower-level, sales-settings-agnostic module and
// can't import these literal unions without a circular import). Values
// only ever reach it already-sanitized against these same enums, by
// sanitizeSalesSettings below and, later, the admin add-client form
// (issue #196).
export function getAllowedCustomerTypes(salesVocabulary?: BrandSalesVocabulary): CustomerType[] {
  return [...CUSTOMER_TYPE_BASE, ...((salesVocabulary?.customerTypes ?? []) as CustomerType[])];
}

export function getAllowedBuyerRoles(salesVocabulary?: BrandSalesVocabulary): BuyerRole[] {
  return [...BUYER_ROLE_BASE, ...((salesVocabulary?.buyerRoles ?? []) as BuyerRole[])];
}

const CUSTOMER_SIZES: CustomerSize[] = ['individual', 'small', 'medium', 'large', 'enterprise'];
const PRICING_MODELS: PricingModel[] = [
  'one_time', 'monthly_subscription', 'annual_subscription', 'framework_agreement',
  'campaign_based', 'per_user', 'per_product', 'per_event', 'custom_quotation',
];
const PURCHASE_FREQUENCIES: PurchaseFrequency[] = [
  'once', 'monthly', 'yearly', 'per_season', 'per_event', 'irregular',
];
const SALES_CYCLE_LENGTHS: SalesCycleLength[] = [
  'under_1_month', '1_3_months', '3_6_months', '6_12_months', 'over_12_months',
];
const REVENUE_PREDICTABILITY: RevenuePredictability[] = [
  'very_predictable', 'predictable', 'medium', 'difficult',
];
const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];
// Issue #145 — derived from app/lib/brand.ts's CURRENCY_CODES, not a
// hand-maintained duplicate list.
const REVENUE_TARGET_CURRENCIES: RevenueTargetCurrency[] = CURRENCY_CODES;
const REVENUE_TARGET_PERIODS: RevenueTargetPeriod[] = ['monthly', 'quarterly', 'annual'];

function sanitizeString(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLength);
}

function sanitizeEnumArray<T extends string>(value: unknown, allowed: T[]): T[] {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set<string>(allowed);
  return Array.from(new Set(value.filter((v): v is T => typeof v === 'string' && allowedSet.has(v))));
}

function sanitizeEnum<T extends string>(value: unknown, allowed: T[]): T | '' {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : '';
}

// Coerces a submitted price/quantity field to a non-negative number, or
// undefined if genuinely absent — never a corrupted string, the same class
// of bug the 2.4.8 ICE-field incident already fixed once for leads. An
// optional `max` clamps the top end too (issue #94) — used only for
// dealSize's own fields below, since those feed directly, unmoderated, into
// lib/ticket-size.ts's estimates; every other pricing field here is left
// unbounded (unchanged behavior) since it isn't this issue's scope.
function sanitizeOptionalNumber(value: unknown, max?: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (Number.isNaN(num)) return undefined;
  const clamped = Math.max(0, num);
  return typeof max === 'number' ? Math.min(clamped, max) : clamped;
}

// A region key with no valid positive-finite multiplier is dropped entirely
// (not coerced to 1 or 0) — an operator who hasn't set one yet gets
// lib/ticket-size.ts's own 1.0 no-op default, never a stored, misleading
// value. Keys are uppercased to match app/lib/normalize-lead.ts's own
// region normalization, so a lookup by a lead's stored (already-uppercased)
// region always matches regardless of how the operator typed it in the UI.
const MAX_REGION_MULTIPLIER_ENTRIES = 50;
function sanitizeRegionMultipliers(value: unknown): RegionMultipliers {
  if (!value || typeof value !== 'object') return {};
  const result: RegionMultipliers = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_REGION_MULTIPLIER_ENTRIES) break;
    const key = sanitizeString(rawKey, 50).toUpperCase();
    if (!key) continue;
    const num = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
    if (!Number.isFinite(num) || num <= 0) continue;
    result[key] = num;
  }
  return result;
}

function sanitizeProductPricing(value: unknown): ProductPricing {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    oneTimePrice: sanitizeOptionalNumber(raw.oneTimePrice),
    monthlyPrice: sanitizeOptionalNumber(raw.monthlyPrice),
    annualPrice: sanitizeOptionalNumber(raw.annualPrice),
    frameworkAnnualValue: sanitizeOptionalNumber(raw.frameworkAnnualValue),
    campaignPrice: sanitizeOptionalNumber(raw.campaignPrice),
    campaignDurationMonths: sanitizeOptionalNumber(raw.campaignDurationMonths),
    perUserPrice: sanitizeOptionalNumber(raw.perUserPrice),
    perUserMinimum: sanitizeOptionalNumber(raw.perUserMinimum),
    perUserTypical: sanitizeOptionalNumber(raw.perUserTypical),
    perProductPrice: sanitizeOptionalNumber(raw.perProductPrice),
    perEventPrice: sanitizeOptionalNumber(raw.perEventPrice),
    customQuotationTypicalValue: sanitizeOptionalNumber(raw.customQuotationTypicalValue),
  };
}

// A negative amount is clamped to 0 by sanitizeOptionalNumber (never
// rejected outright), and computeCoverage() in lib/pipeline-coverage.ts
// treats a 0-or-unset amount identically as "no target" — so a negative
// input safely collapses to the same "not configured" state, not a false
// $0-target alarm.
function sanitizeRevenueTarget(value: unknown, currency: RevenueTargetCurrency): RevenueTarget {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    amount: sanitizeOptionalNumber(raw.amount),
    currency: typeof raw.currency === 'string' && (REVENUE_TARGET_CURRENCIES as string[]).includes(raw.currency)
      ? (raw.currency as RevenueTargetCurrency)
      : defaultRevenueTargetCurrency(currency),
    period: typeof raw.period === 'string' && (REVENUE_TARGET_PERIODS as string[]).includes(raw.period)
      ? (raw.period as RevenueTargetPeriod)
      : 'annual',
  };
}

// Issue #146 — typicalBuyer is validated against the brand-scoped allowed
// set (getAllowedBuyerRoles), not the global BuyerRole union: a value valid
// for one brand but not the brand actually being saved is dropped, matching
// this function's own existing sanitize-not-throw convention (sanitizeEnumArray).
function sanitizeProductLine(value: unknown, index: number, salesVocabulary?: BrandSalesVocabulary): ProductLine {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    id: sanitizeString(raw.id, 100) || `product-${index}`,
    name: sanitizeString(raw.name, 200),
    description: sanitizeString(raw.description, 1000),
    whyTheyBuy: sanitizeString(raw.whyTheyBuy, 1000),
    typicalBuyer: sanitizeEnumArray(raw.typicalBuyer, getAllowedBuyerRoles(salesVocabulary)),
    typicalBuyerOther: sanitizeString(raw.typicalBuyerOther, 200),
    customerSize: sanitizeEnumArray(raw.customerSize, CUSTOMER_SIZES),
    pricingModels: sanitizeEnumArray(raw.pricingModels, PRICING_MODELS),
    pricing: sanitizeProductPricing(raw.pricing),
    revenuePredictability: sanitizeEnum(raw.revenuePredictability, REVENUE_PREDICTABILITY),
  };
}

// Normalizes an arbitrary request body into a well-shaped SalesSettings
// document before it's written to MongoDB — every field defaults to an
// empty/safe value rather than throwing, mirroring app/lib/normalize-lead.ts.
// Upper bound on dealSize's own fields (issue #94) — defense in depth,
// alongside lib/ticket-size.ts's own absolute ceiling on the resulting
// estimate: a fat-fingered "Enterprise customer" value (an extra zero or
// two) can no longer be saved into Sales Settings in the first place,
// rather than relying solely on the downstream cap to catch it. Keep this
// in sync with lib/ticket-size.ts's ABSOLUTE_CEILING — both exist to bound
// the same class of value, just at different points in the pipeline.
const MAX_DEAL_SIZE_INPUT = 50_000_000;

export function sanitizeSalesSettings(
  body: unknown,
  brand: string,
  tenantId: string,
  currency: CurrencyCode = 'USD',
  salesVocabulary?: BrandSalesVocabulary
): SalesSettings {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const dealSizeRaw = (raw.dealSize && typeof raw.dealSize === 'object' ? raw.dealSize : {}) as Record<string, unknown>;
  const upsellRaw = (raw.upsell && typeof raw.upsell === 'object' ? raw.upsell : {}) as Record<string, unknown>;
  const exampleCustomerRaw = (raw.exampleCustomer && typeof raw.exampleCustomer === 'object' ? raw.exampleCustomer : {}) as Record<string, unknown>;
  const seasonalityRaw = (raw.seasonality && typeof raw.seasonality === 'object' ? raw.seasonality : {}) as Record<string, unknown>;

  return {
    brand,
    tenantId,
    companyName: sanitizeString(raw.companyName, 200),
    contactPerson: sanitizeString(raw.contactPerson, 200),
    website: sanitizeString(raw.website, 300),
    mainIndustry: sanitizeString(raw.mainIndustry, 200),
    customerTypes: sanitizeEnumArray(raw.customerTypes, getAllowedCustomerTypes(salesVocabulary)),
    customerTypesOther: sanitizeString(raw.customerTypesOther, 200),
    products: Array.isArray(raw.products) ? raw.products.map((p, i) => sanitizeProductLine(p, i, salesVocabulary)) : [],
    dealSize: {
      small: sanitizeOptionalNumber(dealSizeRaw.small, MAX_DEAL_SIZE_INPUT),
      medium: sanitizeOptionalNumber(dealSizeRaw.medium, MAX_DEAL_SIZE_INPUT),
      large: sanitizeOptionalNumber(dealSizeRaw.large, MAX_DEAL_SIZE_INPUT),
      enterprise: sanitizeOptionalNumber(dealSizeRaw.enterprise, MAX_DEAL_SIZE_INPUT),
      largestWon: sanitizeOptionalNumber(dealSizeRaw.largestWon, MAX_DEAL_SIZE_INPUT),
    },
    regionMultipliers: sanitizeRegionMultipliers(raw.regionMultipliers),
    purchaseFrequency: sanitizeEnumArray(raw.purchaseFrequency, PURCHASE_FREQUENCIES),
    purchaseFrequencyComments: sanitizeString(raw.purchaseFrequencyComments, 1000),
    upsell: {
      commonAdditionalProducts: sanitizeString(upsellRaw.commonAdditionalProducts, 1000),
      typicalValue: sanitizeOptionalNumber(upsellRaw.typicalValue),
    },
    salesCycle: sanitizeEnum(raw.salesCycle, SALES_CYCLE_LENGTHS),
    approver: sanitizeString(raw.approver, 300),
    exampleCustomer: {
      name: sanitizeString(exampleCustomerRaw.name, 200),
      productsPurchased: sanitizeString(exampleCustomerRaw.productsPurchased, 1000),
      totalContractValue: sanitizeOptionalNumber(exampleCustomerRaw.totalContractValue),
      contractLength: sanitizeString(exampleCustomerRaw.contractLength, 200),
    },
    seasonality: {
      quarters: sanitizeEnumArray(seasonalityRaw.quarters, QUARTERS),
      specificMonths: sanitizeString(seasonalityRaw.specificMonths, 300),
    },
    notes: sanitizeString(raw.notes, 4000),
    revenueTarget: sanitizeRevenueTarget(raw.revenueTarget, currency),
  };
}

export const CUSTOMER_TYPE_OPTIONS: { value: CustomerType; label: string }[] = [
  { value: 'sports_clubs', label: 'Sports clubs' },
  { value: 'federations', label: 'Federations' },
  { value: 'schools', label: 'Schools' },
  { value: 'academies', label: 'Academies' },
  { value: 'event_organisers', label: 'Event organisers' },
  { value: 'sponsors', label: 'Sponsors' },
  { value: 'brands', label: 'Brands' },
  { value: 'government', label: 'Government' },
  { value: 'other', label: 'Other' },
];

export const BUYER_ROLE_OPTIONS: { value: BuyerRole; label: string }[] = [
  { value: 'ceo', label: 'CEO' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'coach', label: 'Coach' },
  { value: 'federation', label: 'Federation' },
  { value: 'club', label: 'Club' },
  { value: 'brand', label: 'Brand' },
  { value: 'parent', label: 'Parent' },
  { value: 'athlete', label: 'Athlete' },
  { value: 'other', label: 'Other' },
];

// Issue #146 — the brand-scoped views of the two option lists above, for the
// Company Setup UI to render: only options that fit what the given brand
// actually sells, in the same fixed display order as the full lists.
export function getCustomerTypeOptions(salesVocabulary?: BrandSalesVocabulary): { value: CustomerType; label: string }[] {
  const allowed = new Set(getAllowedCustomerTypes(salesVocabulary));
  return CUSTOMER_TYPE_OPTIONS.filter((opt) => allowed.has(opt.value));
}

export function getBuyerRoleOptions(salesVocabulary?: BrandSalesVocabulary): { value: BuyerRole; label: string }[] {
  const allowed = new Set(getAllowedBuyerRoles(salesVocabulary));
  return BUYER_ROLE_OPTIONS.filter((opt) => allowed.has(opt.value));
}

export const CUSTOMER_SIZE_OPTIONS: { value: CustomerSize; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'small', label: 'Small organisation' },
  { value: 'medium', label: 'Medium organisation' },
  { value: 'large', label: 'Large organisation' },
  { value: 'enterprise', label: 'Enterprise' },
];

export const PRICING_MODEL_OPTIONS: { value: PricingModel; label: string }[] = [
  { value: 'one_time', label: 'One-time purchase' },
  { value: 'monthly_subscription', label: 'Monthly subscription' },
  { value: 'annual_subscription', label: 'Annual subscription' },
  { value: 'framework_agreement', label: 'Framework agreement' },
  { value: 'campaign_based', label: 'Campaign based' },
  { value: 'per_user', label: 'Per user' },
  { value: 'per_product', label: 'Per product sold' },
  { value: 'per_event', label: 'Per event' },
  { value: 'custom_quotation', label: 'Custom quotation' },
];

export const PURCHASE_FREQUENCY_OPTIONS: { value: PurchaseFrequency; label: string }[] = [
  { value: 'once', label: 'Once only' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'per_season', label: 'Before every season' },
  { value: 'per_event', label: 'Before every event' },
  { value: 'irregular', label: 'Irregular' },
];

export const SALES_CYCLE_OPTIONS: { value: SalesCycleLength; label: string }[] = [
  { value: 'under_1_month', label: 'Less than 1 month' },
  { value: '1_3_months', label: '1–3 months' },
  { value: '3_6_months', label: '3–6 months' },
  { value: '6_12_months', label: '6–12 months' },
  { value: 'over_12_months', label: 'More than 12 months' },
];

export const REVENUE_PREDICTABILITY_OPTIONS: { value: RevenuePredictability; label: string }[] = [
  { value: 'very_predictable', label: 'Very predictable' },
  { value: 'predictable', label: 'Predictable' },
  { value: 'medium', label: 'Medium' },
  { value: 'difficult', label: 'Difficult' },
];

export const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: 'Q1', label: 'Q1' },
  { value: 'Q2', label: 'Q2' },
  { value: 'Q3', label: 'Q3' },
  { value: 'Q4', label: 'Q4' },
];

// Issue #145 — derived from app/lib/brand.ts's CURRENCY_CODE_OPTIONS, not a
// hand-maintained duplicate list.
export const REVENUE_TARGET_CURRENCY_OPTIONS: { value: RevenueTargetCurrency; label: string }[] = CURRENCY_CODE_OPTIONS;

export const REVENUE_TARGET_PERIOD_OPTIONS: { value: RevenueTargetPeriod; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];
