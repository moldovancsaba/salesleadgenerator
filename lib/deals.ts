// Manually-managed deals (issue #114) — distinct from lib/ticket-size.ts's
// auto-computed ticketSizeEstimate. A lead can carry multiple deals; nothing
// here ever runs automatically, only in response to an explicit user action
// (add, convert-from-estimate, edit, remove).

const ABSOLUTE_CEILING = 50_000_000; // Same ceiling as lib/ticket-size.ts's own ABSOLUTE_CEILING / app/lib/sales-settings.ts's MAX_DEAL_SIZE_INPUT — one deal shouldn't be able to enter a figure the rest of this app treats as implausible.

export type DealCurrency = 'USD' | 'EUR';

export type DealInput = Record<string, any>;

export type Deal = {
  id: string;
  value: number;
  currency: DealCurrency;
  label?: string;
  createdAt: string;
  updatedAt: string;
  source: 'manual' | 'converted_ticket_estimate';
};

export type SanitizeDealOptions = {
  now?: Date;
  // Existing stored deal this input is replacing (same id) — its
  // createdAt/source are preserved across an edit rather than being
  // re-stamped as if the deal were newly created.
  existing?: Deal | null;
};

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

  const rawValue = Number(input.value);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  const value = Math.min(rawValue, ABSOLUTE_CEILING);

  const now = options?.now ?? new Date();
  const existing = options?.existing ?? null;
  const nowIso = now.toISOString();

  const currency: DealCurrency = input.currency === 'EUR' ? 'EUR' : 'USD';
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 200) : undefined;
  const source: Deal['source'] = input.source === 'converted_ticket_estimate' ? 'converted_ticket_estimate' : 'manual';

  return {
    id: typeof input.id === 'string' && input.id ? input.id : (existing?.id ?? makeId()),
    value,
    currency,
    label: label || undefined,
    createdAt: existing?.createdAt ?? (typeof input.createdAt === 'string' ? input.createdAt : nowIso),
    updatedAt: nowIso,
    source: existing?.source ?? source,
  };
}

// Sanitizes a whole incoming deals[] array, matching lib/contacts.ts's
// dedupeContacts() convention of taking a raw MODIFY payload array and
// returning a clean, storable array — invalid entries are dropped, not
// rejected wholesale (one bad row shouldn't block saving the rest).
export function sanitizeDeals(input: any, existingDeals?: Deal[] | null, now?: Date): Deal[] {
  if (!Array.isArray(input)) return [];
  const existingById = new Map((existingDeals ?? []).map((d) => [d.id, d]));
  return input
    .map((raw) => sanitizeDeal(raw, { now, existing: typeof raw?.id === 'string' ? existingById.get(raw.id) ?? null : null }))
    .filter((d): d is Deal => d !== null);
}

export function sumDeals(deals: Deal[] | undefined | null): number {
  if (!Array.isArray(deals)) return 0;
  return deals.reduce((sum, d) => sum + (Number.isFinite(d?.value) ? d.value : 0), 0);
}
