// Product catalog (issue #215) — promotes the free-text Sales Settings
// product list (ProductLine, ./sales-settings.ts) into a first-class,
// per-brand/tenant catalog with a stable id, a single priced pricingModel,
// and an active/inactive flag, so a rep can attach a concrete, priced line
// item to a Deal (lib/deals.ts) instead of typing a bare number.
// ProductLine[] on SalesSettings is left fully intact and keeps feeding
// lib/ticket-size.ts's per_unit estimation unchanged — this is a separate,
// additive, pricing-facing structure, not a replacement.
//
// Pure module — no Mongo/React — same convention as ./sales-settings.ts's
// own sanitize functions.

import { CURRENCY_CODES } from './brand-constants';
import type { CurrencyCode } from './brand-constants';
import { PRICING_MODEL_OPTIONS } from './sales-settings';
import type { PricingModel, ProductPricing } from './sales-settings';

export type { PricingModel };

// Same ceiling as lib/deals.ts's ABSOLUTE_CEILING / lib/ticket-size.ts's
// ABSOLUTE_CEILING / app/lib/sales-settings.ts's MAX_DEAL_SIZE_INPUT — kept
// in sync per those files' own comments (issue #215 §7's own requirement).
export const PRODUCT_ABSOLUTE_CEILING = 50_000_000;

const PRICING_MODELS: PricingModel[] = PRICING_MODEL_OPTIONS.map((o) => o.value);

export function isValidPricingModel(value: unknown): value is PricingModel {
  return typeof value === 'string' && (PRICING_MODELS as string[]).includes(value);
}

export interface Product {
  id: string;
  brand: string;
  tenantId: string;
  name: string;
  description: string;
  unitPrice: number;
  currency: CurrencyCode;
  pricingModel: PricingModel;
  active: boolean;
  // Set only by the backfill (lib/backfill-products.ts) — the id of the
  // ProductLine it was generated from, used so a re-run can tell "not yet
  // manually edited" apart from "an admin has already touched this row"
  // (never clobber a real, later admin edit — issue #215 §11/§15 #13).
  sourceProductLineId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProductInput = Record<string, any>;

function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLength);
}

function makeId(): string {
  return `product_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type SanitizeProductOptions = {
  now?: Date;
  existing?: Product | null;
};

// Returns null when the input has no usable name/unitPrice/pricingModel —
// never silently coerces a missing/invalid price to 0 or an unrecognized
// pricingModel to a fabricated default (same "never coerce" convention as
// lib/deals.ts's sanitizeDeal()).
export function sanitizeProduct(brand: string, tenantId: string, input: ProductInput, options?: SanitizeProductOptions): Product | null {
  if (!input || typeof input !== 'object') return null;

  const name = sanitizeString(input.name, 200);
  if (!name) return null;

  const rawUnitPrice = Number(input.unitPrice);
  if (!Number.isFinite(rawUnitPrice) || rawUnitPrice <= 0) return null;
  const unitPrice = Math.min(rawUnitPrice, PRODUCT_ABSOLUTE_CEILING);

  if (!isValidPricingModel(input.pricingModel)) return null;

  const existing = options?.existing ?? null;
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();

  const currency: CurrencyCode = CURRENCY_CODES.includes(input.currency) ? input.currency : (existing?.currency ?? 'USD');
  const active = typeof input.active === 'boolean' ? input.active : (existing?.active ?? true);

  return {
    id: typeof input.id === 'string' && input.id ? input.id : (existing?.id ?? makeId()),
    brand,
    tenantId,
    name,
    description: sanitizeString(input.description, 1000),
    unitPrice,
    currency,
    pricingModel: input.pricingModel,
    active,
    sourceProductLineId: existing?.sourceProductLineId ?? (typeof input.sourceProductLineId === 'string' ? input.sourceProductLineId : undefined),
    createdAt: existing?.createdAt ?? (typeof input.createdAt === 'string' ? input.createdAt : nowIso),
    updatedAt: nowIso,
  };
}

export function sanitizeProducts(brand: string, tenantId: string, input: any, existing?: Product[] | null, now?: Date): Product[] {
  if (!Array.isArray(input)) return [];
  const existingById = new Map((existing ?? []).map((p) => [p.id, p]));
  return input
    .map((raw) => sanitizeProduct(brand, tenantId, raw, { now, existing: typeof raw?.id === 'string' ? existingById.get(raw.id) ?? null : null }))
    .filter((p): p is Product => p !== null);
}

// Issue #215 §11's PRICING_MODEL_TO_PRICE_FIELD mapping — which
// ProductPricing field on a Sales Settings ProductLine holds the price for
// a given pricingModel. `per_user` prefers perUserTypical over perUserPrice,
// the exact same precedence lib/backfill-ticket-size.ts's toProductInputs()
// already established for this same field pair.
export function resolveProductLinePrice(pricing: ProductPricing | undefined, model: PricingModel): number | undefined {
  if (!pricing) return undefined;
  switch (model) {
    case 'one_time': return pricing.oneTimePrice;
    case 'monthly_subscription': return pricing.monthlyPrice;
    case 'annual_subscription': return pricing.annualPrice;
    case 'framework_agreement': return pricing.frameworkAnnualValue;
    case 'campaign_based': return pricing.campaignPrice;
    case 'per_user': return pricing.perUserTypical ?? pricing.perUserPrice;
    case 'per_product': return pricing.perProductPrice;
    case 'per_event': return pricing.perEventPrice;
    // Treated as a suggested default only, never a firm price (§13, §15 #12)
    // — the deal line-item UI must present it as an editable estimate
    // requiring confirmation, not silently as a firm catalog rate.
    case 'custom_quotation': return pricing.customQuotationTypicalValue;
    default: return undefined;
  }
}
