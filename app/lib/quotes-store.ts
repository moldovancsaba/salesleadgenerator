import type { Db } from 'mongodb';
import { randomBytes, timingSafeEqual } from 'crypto';
import { getBrandConfig, type Brand } from './brand';
import { tenantFilter } from '../../lib/tenant';
import type { Deal } from '../../lib/deals';
import {
  type Quote, type QuoteStatus,
  buildLineItemFromDeal, isValidStatusTransition,
} from '../../lib/quotes';
import { renderQuotePdf } from '../../lib/quote-pdf';
import { uploadQuotePdf, fetchQuotePdf } from '../../lib/blob-storage';

// Deals: Quote generation, Mongo-aware orchestration (issue #211). Mirrors
// this repo's established app/lib/*-store.ts split: lib/quotes.ts owns pure
// snapshot/transition logic, lib/quote-pdf.tsx and lib/blob-storage.ts own
// PDF rendering and file storage respectively, this file wires them
// together against the real `quotes` Mongo collection. Every read/write
// applies tenantFilter() exactly as every other per-tenant collection in
// this repo — no cross-tenant quote visibility.
const COLLECTION = 'quotes';

// >=128 bits of cryptographic randomness, independent of quoteId/_id — the
// only thing that gates GET /api/quotes/[quoteId]/view. Exported so
// tests/lib/quotes-store.test.ts can assert the length/entropy class
// directly, without needing a real database.
export function generateShareToken(): string {
  return randomBytes(16).toString('hex');
}

function toQuote(doc: any): Quote {
  return {
    _id: doc._id.toString(),
    tenantId: doc.tenantId,
    brand: doc.brand,
    leadId: doc.leadId,
    dealId: doc.dealId,
    status: doc.status,
    lineItems: Array.isArray(doc.lineItems) ? doc.lineItems : [],
    totalValue: doc.totalValue,
    currency: doc.currency,
    pdfBlobPath: doc.pdfBlobPath,
    shareToken: doc.shareToken,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy,
    sentAt: doc.sentAt,
    viewedAt: doc.viewedAt,
    signedAt: doc.signedAt,
    signedBy: doc.signedBy,
  };
}

export type CreateQuoteResult =
  | { ok: true; status: 201; quote: Quote }
  | { ok: false; status: 404 | 409 | 502; error: string };

// The generate step (issue #211 §11): load lead + named Deal (tenant-
// scoped), snapshot it into a line item, render → upload → insert, each
// step's failure short-circuiting the next — never an orphaned Blob object,
// never a half-written quotes document on a failed render/upload.
export async function createQuote(
  db: Db,
  params: { brand: Brand; tenantId: string; leadId: string; dealId: string; actorId: string }
): Promise<CreateQuoteResult> {
  const { brand, tenantId, leadId, dealId, actorId } = params;

  const brandConfig = await getBrandConfig(brand);
  if (!brandConfig) return { ok: false, status: 404, error: 'Unknown brand' };

  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(leadId)) return { ok: false, status: 404, error: 'Lead not found' };

  const lead = await db.collection(brandConfig.dbCollection).findOne({ _id: new ObjectId(leadId), ...tenantFilter(tenantId) });
  if (!lead) return { ok: false, status: 404, error: 'Lead not found' };

  const deal: Deal | undefined = Array.isArray(lead.deals) ? lead.deals.find((d: Deal) => d.id === dealId) : undefined;
  if (!deal) return { ok: false, status: 404, error: 'Deal not found' };

  const lineItem = buildLineItemFromDeal(deal, brandConfig.label);
  if (!lineItem) return { ok: false, status: 409, error: 'Deal has no usable value to quote' };

  const now = new Date();
  // Pre-generated so the PDF's own "Quote reference" can carry the real id
  // before the quotes document is ever inserted — matches issue #211 §11's
  // own pseudocode ordering (render, referencing quoteId, before insert).
  const quoteObjectId = new ObjectId();
  const quoteId = quoteObjectId.toString();

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderQuotePdf({
      brandLabel: brandConfig.label,
      entityName: typeof lead.entity_name === 'string' && lead.entity_name ? lead.entity_name : 'Prospect',
      quoteId,
      createdAt: now.toISOString(),
      lineItems: [lineItem],
      totalValue: lineItem.value,
      currency: lineItem.currency,
    });
  } catch (err) {
    console.error('[app/lib/quotes-store] PDF render failed', err);
    return { ok: false, status: 502, error: 'Failed to render quote PDF' };
  }

  const blobPath = `quotes/${tenantId}/${quoteId}.pdf`;
  try {
    await uploadQuotePdf(blobPath, pdfBuffer);
  } catch (err) {
    console.error('[app/lib/quotes-store] Blob upload failed', err);
    return { ok: false, status: 502, error: 'Failed to store quote PDF' };
  }

  const doc = {
    _id: quoteObjectId,
    tenantId,
    brand,
    leadId,
    dealId,
    status: 'draft' as QuoteStatus,
    lineItems: [lineItem],
    totalValue: lineItem.value,
    currency: lineItem.currency,
    pdfBlobPath: blobPath,
    shareToken: generateShareToken(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: actorId,
  };
  await db.collection(COLLECTION).insertOne(doc);

  return { ok: true, status: 201, quote: toQuote(doc) };
}

export async function listQuotesForLead(db: Db, tenantId: string, leadId: string): Promise<Quote[]> {
  const docs = await db.collection(COLLECTION).find({ leadId, ...tenantFilter(tenantId) }).sort({ createdAt: -1 }).toArray();
  return docs.map(toQuote);
}

// Deliberately NOT tenant-scoped — used only by the public /view route
// (app/api/quotes/[quoteId]/view/route.ts), which gates exclusively on the
// random shareToken, per issue #211 §17 ("must gate exclusively on the
// random shareToken, never on quoteId alone"). Every authenticated route
// uses getQuoteByIdForTenant below instead.
export async function getQuoteById(db: Db, quoteId: string): Promise<Quote | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(quoteId)) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(quoteId) });
  return doc ? toQuote(doc) : null;
}

export async function getQuoteByIdForTenant(db: Db, quoteId: string, tenantId: string): Promise<Quote | null> {
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(quoteId)) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(quoteId), ...tenantFilter(tenantId) });
  return doc ? toQuote(doc) : null;
}

export async function markQuoteSent(db: Db, quoteId: string): Promise<Quote | null> {
  const { ObjectId } = await import('mongodb');
  const now = new Date().toISOString();
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(quoteId) },
    { $set: { status: 'sent', sentAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  return result ? toQuote(result) : null;
}

export type ViewQuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; status: 403 | 404 };

// A repeat visit — including one to an already-signed quote — never
// regresses status; only a real, current 'sent' status ever flips to
// 'viewed', and only once (issue #211 §15's own explicit edge case). A lost
// race against a concurrent first view (two tabs opening the link at once)
// re-reads the now-current record rather than erroring.
// Constant-time, so response timing reveals nothing about how much of a
// guessed token matched (issue #229).
function shareTokenMatches(expected: string | undefined, given: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function recordQuoteView(db: Db, quoteId: string, token: string): Promise<ViewQuoteResult> {
  const quote = await getQuoteById(db, quoteId);
  if (!quote) return { ok: false, status: 404 };
  if (!shareTokenMatches(quote.shareToken, token)) return { ok: false, status: 403 };

  if (quote.status !== 'sent') {
    return { ok: true, quote };
  }

  const { ObjectId } = await import('mongodb');
  const now = new Date().toISOString();
  const updated = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(quoteId), status: 'sent' },
    { $set: { status: 'viewed', viewedAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  if (updated) return { ok: true, quote: toQuote(updated) };

  const fresh = await getQuoteById(db, quoteId);
  return fresh ? { ok: true, quote: fresh } : { ok: false, status: 404 };
}

export type MarkSignedResult =
  | { ok: true; quote: Quote }
  | { ok: false; status: 404 | 409; error: string };

export async function markQuoteSigned(db: Db, quoteId: string, tenantId: string, actorId: string): Promise<MarkSignedResult> {
  const quote = await getQuoteByIdForTenant(db, quoteId, tenantId);
  if (!quote) return { ok: false, status: 404, error: 'Quote not found' };
  if (quote.status === 'signed') return { ok: false, status: 409, error: 'Quote is already signed' };
  if (!isValidStatusTransition(quote.status, 'signed')) {
    return { ok: false, status: 409, error: `Cannot mark a ${quote.status} quote as signed` };
  }

  const { ObjectId } = await import('mongodb');
  const now = new Date().toISOString();
  const updated = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(quoteId) },
    { $set: { status: 'signed', signedAt: now, signedBy: actorId, updatedAt: now } },
    { returnDocument: 'after' }
  );
  return updated ? { ok: true, quote: toQuote(updated) } : { ok: false, status: 404, error: 'Quote not found' };
}

export async function fetchQuotePdfBytes(quote: Quote): Promise<Buffer | null> {
  return fetchQuotePdf(quote.pdfBlobPath);
}

// Real, TTL-indexed rate limiting on the public /view route (issue #211
// §15's own "the route rate-limits or at minimum logs repeated invalid-
// token attempts... bare unthrottled brute force must not be the only
// defense"). Mirrors app/lib/scheduling-store.ts's checkAndRecordRateLimit()
// pattern (Mongo-backed, never in-memory — a Vercel serverless invocation
// is stateless across requests, so an in-process counter would reset on
// every cold start and never actually bound repeated attempts). Scoped
// per-quoteId, not shared globally, so hammering one quote's link can never
// rate-limit a different quote's legitimate viewer.
const VIEW_RATE_LIMIT_COLLECTION = 'quote_view_rate_limits';
const VIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const VIEW_RATE_LIMIT_MAX_PER_WINDOW = 20;

let viewRateLimitIndexEnsured = false;
async function ensureViewRateLimitIndex(db: Db): Promise<void> {
  if (viewRateLimitIndexEnsured) return;
  try {
    await db.collection(VIEW_RATE_LIMIT_COLLECTION).createIndex({ createdAt: 1 }, { expireAfterSeconds: Math.ceil(VIEW_RATE_LIMIT_WINDOW_MS / 1000) + 5 });
    await db.collection(VIEW_RATE_LIMIT_COLLECTION).createIndex({ quoteId: 1, createdAt: 1 });
    viewRateLimitIndexEnsured = true;
  } catch (error) {
    console.error('[app/lib/quotes-store] view rate-limit index creation failed', error);
  }
}

// Returns true when the request is ALLOWED. Inserts a record unconditionally
// (whether allowed or not), so repeated hammering is itself reflected in the
// count until the TTL index expires it.
// Keyed per quote AND client IP (issue #229): keyed on quoteId alone, anyone
// hammering a quote's URL locked its real recipient out too. Vercel
// overwrites x-forwarded-for, so the IP can't be spoofed there.
export async function checkQuoteViewRateLimit(db: Db, quoteId: string, clientIp: string = 'unknown'): Promise<boolean> {
  await ensureViewRateLimitIndex(db);
  const windowStart = new Date(Date.now() - VIEW_RATE_LIMIT_WINDOW_MS);
  const recentCount = await db.collection(VIEW_RATE_LIMIT_COLLECTION).countDocuments({ quoteId, clientIp, createdAt: { $gte: windowStart } });
  await db.collection(VIEW_RATE_LIMIT_COLLECTION).insertOne({ quoteId, clientIp, createdAt: new Date() });
  return recentCount < VIEW_RATE_LIMIT_MAX_PER_WINDOW;
}
