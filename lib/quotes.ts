// Deals: Quote generation (issue #211) — pure, framework/DB-free logic.
// Mirrors lib/deals.ts's own "nothing here ever runs automatically, only in
// response to an explicit user action" philosophy: a Quote is generated,
// sent, viewed, and signed only by an explicit action, and is an immutable
// snapshot of its source Deal at generation time — it never re-reads a Deal
// that may since have been edited.

import type { DealCurrency, DealLineItem } from './deals';

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'signed';

// QuoteLineItem supports both single-line legacy quotes and multi-line CPQ
// catalog quotes. quantity, unitPrice and productId are optional for single-line
// quotes derived purely from flat deal value.
export type QuoteLineItem = {
  label: string;
  value: number;
  currency: DealCurrency;
  quantity?: number;
  unitPrice?: number;
  productId?: string;
};

export type CatalogProductInfo = {
  name: string;
  unitPrice: number;
  currency: DealCurrency;
};

export type CatalogProductLookup = Map<string, CatalogProductInfo>;

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
  signedBy?: string; // rep who manually marked it signed OR buyer email
  signerName?: string;
  signerTitle?: string;
  signerEmail?: string;
  purchaseOrderNumber?: string;
  signatureText?: string;
  signerIp?: string;
};

// The shape returned to an authenticated rep-facing API caller — the raw
// pdfBlobPath/shareToken are never included; viewUrl and portalUrl are the
// URLs built from shareToken a caller actually needs, and only ever full
// URLs, never the token itself (so a client response can never be used to
// reconstruct another quote's token). See docs/ARCHITECTURE.md's "Quotes"
// section for why this differs from the issue's own literal §9 Quote shape.
export type PublicQuote = Omit<Quote, 'pdfBlobPath' | 'shareToken' | 'signerIp'> & {
  viewUrl: string;
  portalUrl?: string;
};

export function toPublicQuote(quote: Quote, viewUrl: string, portalUrl?: string): PublicQuote {
  const { pdfBlobPath, shareToken, signerIp, ...rest } = quote;
  void pdfBlobPath;
  void shareToken;
  void signerIp;
  return portalUrl ? { ...rest, viewUrl, portalUrl } : { ...rest, viewUrl };
}

export type BuyerAcceptanceInput = {
  signerName: string;
  signerEmail: string;
  signerTitle?: string;
  purchaseOrderNumber?: string;
  signatureText: string;
};

export type ValidatedBuyerAcceptance =
  | { ok: true; data: BuyerAcceptanceInput }
  | { ok: false; error: string };

export function validateBuyerAcceptanceInput(raw: unknown): ValidatedBuyerAcceptance {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid request payload' };
  }
  const obj = raw as Record<string, unknown>;
  const signerName = typeof obj.signerName === 'string' ? obj.signerName.trim().slice(0, 120) : '';
  const signerEmail = typeof obj.signerEmail === 'string' ? obj.signerEmail.trim().toLowerCase().slice(0, 160) : '';
  const signerTitle = typeof obj.signerTitle === 'string' ? obj.signerTitle.trim().slice(0, 120) : '';
  const purchaseOrderNumber = typeof obj.purchaseOrderNumber === 'string' ? obj.purchaseOrderNumber.trim().slice(0, 80) : '';
  const signatureText = typeof obj.signatureText === 'string' ? obj.signatureText.trim().slice(0, 120) : '';

  if (signerName.length < 2) {
    return { ok: false, error: 'Signer full name is required (at least 2 characters)' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
    return { ok: false, error: 'A valid business email address is required' };
  }
  if (signatureText.length < 2) {
    return { ok: false, error: 'Typed e-signature is required' };
  }

  return {
    ok: true,
    data: {
      signerName,
      signerEmail,
      ...(signerTitle ? { signerTitle } : {}),
      ...(purchaseOrderNumber ? { purchaseOrderNumber } : {}),
      signatureText,
    },
  };
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

// Multi-line CPQ quote generation: resolves Deal.lineItems against productLookup.
// Falls back to single line item from deal value when line items cannot be resolved.
export function buildLineItemsFromDeal(
  deal: { value: number; currency: DealCurrency; label?: string; lineItems?: DealLineItem[] },
  brandLabel: string,
  productLookup?: CatalogProductLookup
): QuoteLineItem[] {
  if (Array.isArray(deal.lineItems) && deal.lineItems.length > 0 && productLookup && productLookup.size > 0) {
    const items: QuoteLineItem[] = [];
    for (const item of deal.lineItems) {
      if (!item || !item.productId || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        continue;
      }
      const product = productLookup.get(item.productId);
      if (!product) continue;
      const unitPrice = typeof item.unitPriceOverride === 'number' && Number.isFinite(item.unitPriceOverride) && item.unitPriceOverride >= 0
        ? item.unitPriceOverride
        : product.unitPrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
      const value = item.quantity * unitPrice;
      if (!Number.isFinite(value) || value <= 0) continue;

      items.push({
        label: product.name?.trim() || `${brandLabel} — ${item.productId}`,
        value,
        currency: product.currency || deal.currency,
        quantity: item.quantity,
        unitPrice,
        productId: item.productId,
      });
    }
    if (items.length > 0) {
      return items;
    }
  }

  const single = buildLineItemFromDeal(deal, brandLabel);
  return single ? [single] : [];
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
