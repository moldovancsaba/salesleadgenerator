// Backfill for issue #215: promotes each brand/tenant's existing Sales
// Settings ProductLine[] (app/lib/sales-settings.ts, feeds
// lib/ticket-size.ts's per_unit estimation, unchanged by this) into the new
// `products` catalog collection, one row per priced pricingModel. Mirrors
// lib/backfill-ticket-size.ts's shape exactly: takes a raw `db`, returns a
// scan/outcome report, idempotent by construction — a second `apply: true`
// run over already-backfilled, untouched data reports everything
// "unchanged". Never clobbers a row an admin has manually edited since the
// initial backfill (checked via updatedAt > createdAt, issue #215 §11/§15 #13).

import { sanitizeProduct, resolveProductLinePrice, PRODUCT_ABSOLUTE_CEILING } from '../app/lib/products';
import type { Product } from '../app/lib/products';
import type { CurrencyCode } from '../app/lib/brand-constants';
import type { PricingModel, ProductLine } from '../app/lib/sales-settings';

export const PRODUCTS_COLLECTION = 'products';

export type BackfillProductResult = { id: string; outcome: 'created' | 'updated' | 'unchanged' | 'skipped_unnamed' | 'skipped_unpriced' };
export type BackfillProductsResult = {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  docs: BackfillProductResult[];
};

// `db` is a real mongodb driver Db instance — same convention as
// lib/backfill-ticket-size.ts/lib/backfill-title-normalization.ts.
export async function backfillProductsForBrand(
  db: any,
  brand: string,
  tenantId: string,
  currency: CurrencyCode,
  { apply }: { apply: boolean },
  now: () => Date = () => new Date()
): Promise<BackfillProductsResult> {
  const result: BackfillProductsResult = { scanned: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, docs: [] };

  const settings = await db.collection('company_settings').findOne({ brand, tenantId });
  const productLines: ProductLine[] = Array.isArray(settings?.products) ? settings.products : [];
  if (productLines.length === 0) return result;

  const productsCollection = db.collection(PRODUCTS_COLLECTION);

  for (const line of productLines) {
    result.scanned++;

    const name = typeof line?.name === 'string' ? line.name.trim() : '';
    if (!name) {
      result.skipped++;
      result.docs.push({ id: line?.id || '(unnamed)', outcome: 'skipped_unnamed' });
      continue;
    }

    const models: PricingModel[] = Array.isArray(line.pricingModels) ? line.pricingModels : [];
    const priced = models
      .map((model) => ({ model, price: resolveProductLinePrice(line.pricing, model) }))
      .filter((p): p is { model: PricingModel; price: number } => typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0);

    if (priced.length === 0) {
      result.skipped++;
      result.docs.push({ id: line.id, outcome: 'skipped_unpriced' });
      continue;
    }

    for (const { model, price } of priced) {
      const catalogId = `${line.id}__${model}`;
      const existing = (await productsCollection.findOne({ brand, tenantId, id: catalogId })) as Product | null;

      // A row an admin has manually saved after the backfill created it
      // (updatedAt strictly after createdAt) is left alone — a re-run must
      // never fight an ongoing admin edit (§11/§15 #13).
      if (existing && existing.updatedAt > existing.createdAt) {
        result.unchanged++;
        result.docs.push({ id: catalogId, outcome: 'unchanged' });
        continue;
      }

      // Built with existing: null even when a backfill-owned row already
      // exists, so createdAt === updatedAt on the resulting candidate
      // regardless — a backfill-driven write must never itself set
      // updatedAt strictly after createdAt, or the very next run would
      // wrongly treat its own last write as a manual edit and stop
      // tracking source-data changes for that row forever.
      const candidate = sanitizeProduct(brand, tenantId, {
        id: catalogId,
        name,
        description: line.description,
        unitPrice: Math.min(price, PRODUCT_ABSOLUTE_CEILING),
        currency,
        pricingModel: model,
        active: existing?.active ?? true,
        sourceProductLineId: line.id,
      }, { now: now(), existing: null });

      if (!candidate) {
        result.skipped++;
        result.docs.push({ id: catalogId, outcome: 'skipped_unpriced' });
        continue;
      }

      if (!existing) {
        result.created++;
        result.docs.push({ id: catalogId, outcome: 'created' });
        if (apply) await productsCollection.insertOne(candidate);
        continue;
      }

      const changed = existing.name !== candidate.name
        || existing.description !== candidate.description
        || existing.unitPrice !== candidate.unitPrice
        || existing.currency !== candidate.currency;

      if (!changed) {
        result.unchanged++;
        result.docs.push({ id: catalogId, outcome: 'unchanged' });
        continue;
      }

      result.updated++;
      result.docs.push({ id: catalogId, outcome: 'updated' });
      if (apply) {
        await productsCollection.updateOne({ brand, tenantId, id: catalogId }, {
          $set: {
            name: candidate.name,
            description: candidate.description,
            unitPrice: candidate.unitPrice,
            currency: candidate.currency,
            createdAt: candidate.createdAt,
            updatedAt: candidate.createdAt,
          },
        });
      }
    }
  }

  return result;
}
