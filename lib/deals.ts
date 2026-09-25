// Manually-managed deals (issue #114) — distinct from lib/ticket-size.ts's
// auto-computed ticketSizeEstimate. A lead can carry multiple deals; nothing
// here ever runs automatically, only in response to an explicit user action
// (add, convert-from-estimate, edit, remove).

// Issue #196 — imports from @/app/lib/brand-constants, not @/app/lib/brand:
// this module is used by Client Components (app/card.tsx, app/detail.tsx)
// and @/app/lib/brand is now server-only (imports lib/mongodb.ts).
import { CURRENCY_CODES } from '@/app/lib/brand-constants';
import type { CurrencyCode } from '@/app/lib/brand-constants';

const ABSOLUTE_CEILING = 50_000_000; // Same ceiling as lib/ticket-size.ts's own ABSOLUTE_CEILING / app/lib/sales-settings.ts's MAX_DEAL_SIZE_INPUT — one deal shouldn't be able to enter a figure the rest of this app treats as implausible.

// Issue #145 — re-exported from app/lib/brand.ts's single currency source of
// truth rather than an independent 'USD' | 'EUR' union.
export type DealCurrency = CurrencyCode;

export type DealInput = Record<string, any>;

// A catalog line item on a Deal (issue #215) — resolved and snapshotted at
// save time, never auto-refreshed in the background (matches this module's
// own "nothing here ever runs automatically" philosophy above). See
// resolveLineItems() below for exactly how unitPriceOverride is derived on
// each save: a caller (the UI) that wants a line item to keep tracking the
// catalog's current price simply omits unitPriceOverride from that line
// item's input on the next save; sending one always freezes it.
export type DealLineItem = {
  productId: string;
  quantity: number;
  unitPriceOverride?: number;
};

// Minimal shape resolveLineItems() needs per product — callers (e.g.
// app/lib/lead-actions.ts) build this from a real `products` collection
// query, scoped to the deal's own brand+tenantId; this module stays
// Mongo-free.
export type ProductPriceLookup = Map<string, { unitPrice: number; currency: DealCurrency }>;

export type Deal = {
  id: string;
  value: number;
  currency: DealCurrency;
  label?: string;
  createdAt: string;
  updatedAt: string;
  source: 'manual' | 'converted_ticket_estimate' | 'catalog_line_items';
  lineItems?: DealLineItem[];
};

export type SanitizeDealOptions = {
  now?: Date;
  // Existing stored deal this input is replacing (same id) — its
  // createdAt/source are preserved across an edit rather than being
  // re-stamped as if the deal were newly created.
  existing?: Deal | null;
  // Issue #215 — resolves lineItems[].productId against the deal's own
  // brand/tenant catalog. Omitted (or empty) entirely disables the
  // line-item path: any input.lineItems is then ignored and the bare-value
  // path runs, exactly as it did before this option existed.
  productLookup?: ProductPriceLookup;
};

// Issue #215 §11 — resolves a deal's raw lineItems input into a priced,
// storable line-item list plus its total. Drops (never rejects the whole
// deal for) any entry with an unknown productId, a non-positive/non-finite
// quantity, or a product whose currency doesn't match the deal's own
// currency (no FX conversion anywhere in this app). Returns null when
// nothing in the input resolves to a valid line item, so the caller can
// fall back to the bare-value path unchanged (§15 #8).
function resolveLineItems(
  rawLineItems: any,
  dealCurrency: DealCurrency,
  productLookup: ProductPriceLookup,
  ceiling: number
): { lineItems: DealLineItem[]; total: number } | null {
  if (!Array.isArray(rawLineItems) || rawLineItems.length === 0) return null;

  const resolved: DealLineItem[] = [];
  let total = 0;

  for (const raw of rawLineItems) {
    if (!raw || typeof raw !== 'object' || typeof raw.productId !== 'string') continue;
    const product = productLookup.get(raw.productId);
    if (!product) continue;

    const rawQuantity = Number(raw.quantity);
    if (!Number.isFinite(rawQuantity) || rawQuantity < 1) continue;
    const quantity = Math.round(rawQuantity);

    if (product.currency !== dealCurrency) continue;

    const rawOverride = Number(raw.unitPriceOverride);
    const unitPrice = Number.isFinite(rawOverride) && rawOverride > 0 ? rawOverride : product.unitPrice;

    resolved.push({ productId: raw.productId, quantity, unitPriceOverride: unitPrice });
    total += quantity * unitPrice;
  }

  if (resolved.length === 0) return null;
  return { lineItems: resolved, total: Math.min(total, ceiling) };
}

function makeId(): string {
  // No Math.random()/Date.now() ban applies outside Workflow scripts — this
  // runs in normal request handlers, not a workflow script.
  return `deal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Validates/clamps a single deal entry. Returns null when the entry has no
// usable value (never silently coerces a missing/invalid value to 0 and
// stores it — that would look like a real $0 deal).
export function sanitizeDeal(input: DealInput, options?: SanitizeDealOptions): Deal | null {
  if (!input || typeof input !== 'object') return null;

  const now = options?.now ?? new Date();
  const existing = options?.existing ?? null;
  const nowIso = now.toISOString();

  // Issue #169 — validated against the real, extensible CurrencyCode set
  // (app/lib/brand.ts's single source of truth) instead of a hardcoded
  // 'EUR'-or-else-'USD' ternary, which silently mis-stored any other valid
  // currency code as USD.
  const currency: DealCurrency = CURRENCY_CODES.includes(input.currency) ? input.currency : 'USD';
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 200) : undefined;

  const id = typeof input.id === 'string' && input.id ? input.id : (existing?.id ?? makeId());
  const createdAt = existing?.createdAt ?? (typeof input.createdAt === 'string' ? input.createdAt : nowIso);

  // Issue #215 §11/§15 #9 — when lineItems resolves to at least one valid
  // entry, the server-computed total always wins, ignoring any client-sent
  // input.value outright (prevents a stale/tampered figure from bypassing
  // catalog pricing). A request sending both lineItems and value never
  // reaches the bare-value branch below in that case.
  if (options?.productLookup) {
    const resolved = resolveLineItems(input.lineItems, currency, options.productLookup, ABSOLUTE_CEILING);
    if (resolved) {
      return {
        id,
        value: resolved.total,
        currency,
        label: label || undefined,
        createdAt,
        updatedAt: nowIso,
        source: 'catalog_line_items',
        lineItems: resolved.lineItems,
      };
    }
  }

  // Bare-value path — unchanged from before issue #215, and also the
  // fallback when every lineItems entry was invalid (§15 #8): a deal never
  // silently becomes a fabricated $0 just because its line items didn't
  // resolve.
  const rawValue = Number(input.value);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  const value = Math.min(rawValue, ABSOLUTE_CEILING);
  const source: Deal['source'] = input.source === 'converted_ticket_estimate' ? 'converted_ticket_estimate' : 'manual';
  // A deal previously saved as catalog_line_items that no longer resolves
  // any line items on this save is no longer catalog-derived — never
  // preserve a 'catalog_line_items' source alongside an undefined
  // lineItems array, which would misrepresent this deal's own provenance.
  const preservedSource = existing?.source === 'catalog_line_items' ? 'manual' : existing?.source;

  return {
    id,
    value,
    currency,
    label: label || undefined,
    createdAt,
    updatedAt: nowIso,
    source: preservedSource ?? source,
  };
}

// Sanitizes a whole incoming deals[] array, matching lib/contacts.ts's
// dedupeContacts() convention of taking a raw MODIFY payload array and
// returning a clean, storable array — invalid entries are dropped, not
// rejected wholesale (one bad row shouldn't block saving the rest).
export function sanitizeDeals(input: any, existingDeals?: Deal[] | null, now?: Date, productLookup?: ProductPriceLookup): Deal[] {
  if (!Array.isArray(input)) return [];
  const existingById = new Map((existingDeals ?? []).map((d) => [d.id, d]));
  return input
    .map((raw) => sanitizeDeal(raw, { now, productLookup, existing: typeof raw?.id === 'string' ? existingById.get(raw.id) ?? null : null }))
    .filter((d): d is Deal => d !== null);
}

export function sumDeals(deals: Deal[] | undefined | null): number {
  if (!Array.isArray(deals)) return 0;
  return deals.reduce((sum, d) => sum + (Number.isFinite(d?.value) ? d.value : 0), 0);
}
