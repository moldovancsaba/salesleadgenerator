import { describe, it, expect } from 'vitest';
import { backfillProductsForBrand } from '../../lib/backfill-products';

const NOW = () => new Date('2026-09-25T00:00:00.000Z');

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses — same pattern as
// tests/lib/backfill-ticket-size.test.ts's fakeDb, with a real in-memory
// `products` store (find-by-filter/insert/update) since this backfill,
// unlike ticket-size's, both reads and writes the same collection.
function fakeDb(initialSettingsDoc: any, existingProducts: any[] = []) {
  let settingsDoc = initialSettingsDoc;
  const products = [...existingProducts];
  const inserts: any[] = [];
  const updates: Array<{ filter: any; set: any }> = [];
  return {
    collection: (name: string) => {
      if (name === 'company_settings') {
        return { findOne: async () => settingsDoc };
      }
      return {
        findOne: async (filter: any) => products.find((p) => p.brand === filter.brand && p.tenantId === filter.tenantId && p.id === filter.id) ?? null,
        insertOne: async (doc: any) => { products.push(doc); inserts.push(doc); },
        updateOne: async (filter: any, update: any) => {
          const existing = products.find((p) => p.brand === filter.brand && p.tenantId === filter.tenantId && p.id === filter.id);
          if (existing) Object.assign(existing, update.$set);
          updates.push({ filter, set: update.$set });
        },
      };
    },
    _products: products,
    _inserts: inserts,
    _updates: updates,
    _setSettings: (doc: any) => { settingsDoc = doc; },
  };
}

const BRAND = 'cogmap';
const TENANT = 'default';

describe('backfillProductsForBrand', () => {
  it('fans out a multi-model ProductLine into one catalog row per priced model', async () => {
    const db = fakeDb({
      brand: BRAND, tenantId: TENANT,
      products: [{
        id: 'sponsorship', name: 'Sponsorship Package', description: 'Season sponsorship',
        pricingModels: ['monthly_subscription', 'annual_subscription'],
        pricing: { monthlyPrice: 5000, annualPrice: 45000 },
      }],
    });
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);

    expect(result.created).toBe(2);
    expect(db._products).toHaveLength(2);
    expect(db._products.map((p: any) => p.id).sort()).toEqual(['sponsorship__annual_subscription', 'sponsorship__monthly_subscription']);
    expect(db._products.find((p: any) => p.id === 'sponsorship__annual_subscription').unitPrice).toBe(45000);
  });

  it('records skipped_unnamed for a ProductLine with a blank name', async () => {
    const db = fakeDb({
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: '   ', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
    });
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(result.skipped).toBe(1);
    expect(result.docs[0].outcome).toBe('skipped_unnamed');
    expect(db._products).toHaveLength(0);
  });

  it('records skipped_unpriced when no selected pricingModel has a matching numeric price', async () => {
    const db = fakeDb({
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: 'Unpriced Thing', pricingModels: ['one_time', 'monthly_subscription'], pricing: {} }],
    });
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(result.skipped).toBe(1);
    expect(result.docs[0].outcome).toBe('skipped_unpriced');
    expect(db._products).toHaveLength(0);
  });

  it('never writes in dry-run mode (apply: false)', async () => {
    const db = fakeDb({
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: 'Widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
    });
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: false }, NOW);
    expect(result.created).toBe(1);
    expect(db._products).toHaveLength(0);
  });

  it('is idempotent — a second apply run over already-backfilled, untouched data reports everything unchanged', async () => {
    const settings = {
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: 'Widget', description: 'A widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
    };
    const db = fakeDb(settings);
    await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    const second = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it('a re-run picks up a real source-data change and updates the unmanually-touched row', async () => {
    const db = fakeDb({
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: 'Widget', description: 'A widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
    });
    await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    db._setSettings({
      brand: BRAND, tenantId: TENANT,
      products: [{ id: 'x', name: 'Widget', description: 'A widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 150 } }],
    });
    const second = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(second.updated).toBe(1);
    expect(db._products.find((p: any) => p.id === 'x__one_time').unitPrice).toBe(150);
  });

  it('never clobbers a row an admin has manually edited since the initial backfill (§15 #13)', async () => {
    const db = fakeDb(
      {
        brand: BRAND, tenantId: TENANT,
        products: [{ id: 'x', name: 'Widget', description: 'A widget', pricingModels: ['one_time'], pricing: { oneTimePrice: 100 } }],
      },
      [{
        id: 'x__one_time', brand: BRAND, tenantId: TENANT, name: 'Manually Renamed', description: 'Admin edited this',
        unitPrice: 999, currency: 'USD', pricingModel: 'one_time', active: true, sourceProductLineId: 'x',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', // updatedAt > createdAt
      }]
    );
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(result.unchanged).toBe(1);
    expect(db._products[0].name).toBe('Manually Renamed');
    expect(db._products[0].unitPrice).toBe(999);
  });

  it('returns an empty (zero-scanned) result for a brand/tenant with no company_settings doc or empty products', async () => {
    const db = fakeDb(null);
    const result = await backfillProductsForBrand(db, BRAND, TENANT, 'USD', { apply: true }, NOW);
    expect(result.scanned).toBe(0);
    expect(db._products).toHaveLength(0);
  });
});
