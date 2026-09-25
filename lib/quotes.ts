// Deals: Quote generation (issue #211) — pure, framework/DB-free logic.
// Mirrors lib/deals.ts's own "nothing here ever runs automatically, only in
// response to an explicit user action" philosophy: a Quote is generated,
// sent, viewed, and signed only by an explicit action, and is an immutable
// snapshot of its source Deal at generation time — it never re-reads a Deal
// that may since have been edited.

import type { DealCurrency } from './deals';

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'signed';

// v1 always carries exactly one entry, derived 1:1 from the source Deal.
// The array shape (not a bare single object) is deliberate — it is what
// lets a future "Catalog: Product and price book"-style multi-line quote
// extend this to N line items without a breaking schema change.
export type QuoteLineItem = {
  label: string;
  value: number;
  currency: DealCurrency;
};

export type Quote = {
  _id: string;
  tenantId: string;
  brand: string;
  leadId: string;
  dealId: string; // the source Deal.id this quote snapshots
  status: QuoteStatus;
  lineItems: QuoteLineItem[];
  totalValue: number; // sum of lineItems — always == the single item's value in v1
  currency: DealCurrency;
  pdfBlobPath: string; // internal Vercel Blob pathname — never returned to a client
  shareToken: string; // cryptographically random (>=128 bits) — the only thing that gates /view
  createdAt: string;
  updatedAt: string;
  createdBy: string; // rep who generated it
  sentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  signedBy?: string; // rep who manually marked it signed (v1 — no real signer identity)
};

// The shape returned to an authenticated rep-facing API caller — the raw
// pdfBlobPath/shareToken are never included; viewUrl is the one thing built
// from shareToken a caller actually needs, and only ever a full URL, never
// the token itself (so a client response can never be used to reconstruct
// another quote's token). See docs/ARCHITECTURE.md's "Quotes" section for
// why this differs from the issue's own literal §9 Quote shape.
export type PublicQuote = Omit<Quote, 'pdfBlobPath' | 'shareToken'> & { viewUrl: string };

export function toPublicQuote(quote: Quote, viewUrl: string): PublicQuote {
  const { pdfBlobPath, shareToken, ...rest } = quote;
  void pdfBlobPath;
  void shareToken;
  return { ...rest, viewUrl };
}

// A quote with no positive value has nothing to quote — mirrors
// sanitizeDeal()'s own "no usable value -> null, never a fabricated $0"
// contract (lib/deals.ts). label falls back to a generic brand-derived
// value only when the source Deal itself has none.
export function buildLineItemFromDeal(
  deal: { value: number; currency: DealCurrency; label?: string },
  brandLabel: string
): QuoteLineItem | null {
  if (!Number.isFinite(deal.value) || deal.value <= 0) return null;
  const trimmedLabel = typeof deal.label === 'string' ? deal.label.trim() : '';
  return {
    label: trimmedLabel || `${brandLabel} — Services`,
    value: deal.value,
    currency: deal.currency,
  };
}

export function sumLineItems(lineItems: QuoteLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
}

// Status transitions are monotonic and enforced server-side: draft -> sent
// -> viewed -> signed, with sent -> signed also allowed (a prospect may
// sign without the view-tracking route ever firing, e.g. a PDF forwarded by
// email) — but no transition ever moves status backward, and no same-status
// "transition" is valid either (a repeat view/sign attempt is handled by
// the caller as a no-op or a 409, never routed through this as a success).
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent'],
  sent: ['viewed', 'signed'],
  viewed: ['signed'],
  signed: [],
};

export function isValidStatusTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
