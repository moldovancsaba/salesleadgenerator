// Backfill for issue #81: every lead written before issue #79 shipped (or
// before a brand's Sales Settings were filled in) has no ticketSizeEstimate
// at all — this scans a brand's collection and computes/writes it via the
// same estimateTicketSize() every live write path now uses. Idempotent by
// construction: re-running finds "unchanged" for any lead whose stored
// estimate already matches what estimateTicketSize() would derive today
// (compared on method+expected, not computedAt, which legitimately differs
// on every run). Mirrors lib/backfill-title-normalization.ts's shape —
// touches Mongo directly via a raw `db`, the same established exception
// this repo's backfill scripts already carve out from the app/lib/ vs lib/
// split, rather than re-deriving a second copy of the algorithm.

import { estimateTicketSize } from './ticket-size';
import type { DealSizeBands, TicketSizeCurrency, TicketSizeProductInput, TicketSizeTier } from './ticket-size';

const VALID_SIZE_TIERS: TicketSizeTier[] = ['Small', 'Medium', 'Large', 'Enterprise'];

export type BackfillDocResult = { id: string; outcome: 'updated' | 'unchanged'; method: string };
export type BackfillCollectionResult = {
  scanned: number;
  updated: number;
  unchanged: number;
  methodCounts: Record<string, number>;
  docs: BackfillDocResult[];
};

function toProductInputs(products: any[]): TicketSizeProductInput[] {
  if (!Array.isArray(products)) return [];
  return products.map((p) => ({
    customerSize: Array.isArray(p?.customerSize) ? p.customerSize : [],
    perUnitRate: p?.pricing?.perUserTypical ?? p?.pricing?.perUserPrice,
  }));
}

// `db` is a real mongodb driver Db instance (or mongoose's `connection.db`),
// same convention as lib/migrate-decision-maker.ts/lib/backfill-title-normalization.ts.
export async function backfillTicketSizeCollection(
  db: any,
  collectionName: string,
  brand: string,
  tenantId: string,
  currency: TicketSizeCurrency,
  { apply }: { apply: boolean },
  now: () => Date = () => new Date()
): Promise<BackfillCollectionResult> {
  const settings = await db.collection('company_settings').findOne({ brand, tenantId });
  const dealSize: DealSizeBands = settings?.dealSize || {};
  const products = toProductInputs(settings?.products);
  const regionMultipliers: Record<string, number> = settings?.regionMultipliers || {};

  const collection = db.collection(collectionName);
  const cursor = collection.find({});

  const result: BackfillCollectionResult = { scanned: 0, updated: 0, unchanged: 0, methodCounts: {}, docs: [] };

  for await (const doc of cursor) {
    result.scanned++;

    const sizeTier = (VALID_SIZE_TIERS as string[]).includes(doc.size) ? (doc.size as TicketSizeTier) : undefined;
    const unitCount = typeof doc.estimated_participants === 'number' && doc.estimated_participants > 0
      ? doc.estimated_participants
      : undefined;

    const regionMultiplier = typeof doc.region === 'string' ? regionMultipliers[doc.region.toUpperCase()] : undefined;
    const newEstimate = estimateTicketSize({ sizeTier, unitCount, currency, regionMultiplier }, dealSize, products, now);
    result.methodCounts[newEstimate.method] = (result.methodCounts[newEstimate.method] || 0) + 1;

    const existing = doc.ticketSizeEstimate;
    const existingExpected = existing && existing.method !== 'unconfigured' ? existing.expected : undefined;
    const newExpected = newEstimate.method !== 'unconfigured' ? newEstimate.expected : undefined;
    const unchanged = !!existing && existing.method === newEstimate.method && existingExpected === newExpected;

    if (unchanged) {
      result.unchanged++;
      result.docs.push({ id: String(doc._id), outcome: 'unchanged', method: newEstimate.method });
    } else {
      result.updated++;
      result.docs.push({ id: String(doc._id), outcome: 'updated', method: newEstimate.method });
      if (apply) {
        await collection.updateOne({ _id: doc._id }, { $set: { ticketSizeEstimate: newEstimate } });
      }
    }
  }

  return result;
}
