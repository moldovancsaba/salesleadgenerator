import { describe, it, expect, vi } from 'vitest';
import {
  extractProductLinePrimaryPricing,
  syncSalesSettingsProductsToCatalog,
  syncCatalogProductToSalesSettings,
} from '../../lib/product-catalog-sync';
import type { ProductLine } from '../../app/lib/sales-settings';
import type { Product } from '../../app/lib/products';

describe('product-catalog-sync', () => {
  describe('extractProductLinePrimaryPricing', () => {
    it('extracts primary pricing model and non-zero unit price', () => {
      const line: ProductLine = {
        id: 'p1',
        name: 'Club SaaS',
        description: 'SaaS platform',
        whyTheyBuy: 'Automation',
        typicalBuyer: ['club'],
        typicalBuyerOther: '',
        customerSize: ['small'],
        pricingModels: ['monthly_subscription', 'annual_subscription'],
        pricing: {
          monthlyPrice: 150,
          annualPrice: 1500,
        },
        revenuePredictability: 'very_predictable',
      };

      const extracted = extractProductLinePrimaryPricing(line);
      expect(extracted).toEqual({
        pricingModel: 'monthly_subscription',
        unitPrice: 150,
      });
    });

    it('falls back to second pricing model if first has no price', () => {
      const line: ProductLine = {
        id: 'p2',
        name: 'Court Kit',
        description: 'Hardware kit',
        whyTheyBuy: '',
        typicalBuyer: [],
        typicalBuyerOther: '',
        customerSize: [],
        pricingModels: ['one_time', 'custom_quotation'],
        pricing: {
          customQuotationTypicalValue: 35000,
        },
        revenuePredictability: 'predictable',
      };

      const extracted = extractProductLinePrimaryPricing(line);
      expect(extracted).toEqual({
        pricingModel: 'custom_quotation',
        unitPrice: 35000,
      });
    });

    it('returns null if line has no positive price', () => {
      const line: ProductLine = {
        id: 'p3',
        name: 'Free Trial',
        description: '',
        whyTheyBuy: '',
        typicalBuyer: [],
        typicalBuyerOther: '',
        customerSize: [],
        pricingModels: ['one_time'],
        pricing: {},
        revenuePredictability: '',
      };

      expect(extractProductLinePrimaryPricing(line)).toBeNull();
    });
  });

  describe('syncSalesSettingsProductsToCatalog', () => {
    it('creates new catalog products when none exist', async () => {
      const inserted: any[] = [];
      const updated: any[] = [];

      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
          insertOne: vi.fn().mockImplementation((doc) => {
            inserted.push(doc);
            return Promise.resolve({ insertedId: 'mock-id' });
          }),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            updated.push({ filter, update });
            return Promise.resolve({});
          }),
        }),
      };

      const productLines: ProductLine[] = [
        {
          id: 'line-1',
          name: 'Padel SaaS',
          description: 'Online booking',
          whyTheyBuy: '',
          typicalBuyer: [],
          typicalBuyerOther: '',
          customerSize: [],
          pricingModels: ['monthly_subscription'],
          pricing: { monthlyPrice: 150 },
          revenuePredictability: 'predictable',
        },
      ];

      const res = await syncSalesSettingsProductsToCatalog(mockDb, 'padel-africa', 'default', productLines, 'EUR');
      expect(res.created).toBe(1);
      expect(res.updated).toBe(0);
      expect(inserted).toHaveLength(1);
      expect(inserted[0].name).toBe('Padel SaaS');
      expect(inserted[0].unitPrice).toBe(150);
      expect(inserted[0].pricingModel).toBe('monthly_subscription');
      expect(inserted[0].currency).toBe('EUR');
    });

    it('updates existing catalog product matching by name', async () => {
      const existingProduct: Product = {
        id: 'prod-existing',
        brand: 'padel-africa',
        tenantId: 'default',
        name: 'Padel SaaS',
        description: 'Old desc',
        unitPrice: 100,
        currency: 'EUR',
        pricingModel: 'monthly_subscription',
        active: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      };

      const updatedDocs: any[] = [];
      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([existingProduct]),
          }),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            updatedDocs.push({ filter, update });
            return Promise.resolve({});
          }),
        }),
      };

      const productLines: ProductLine[] = [
        {
          id: 'line-1',
          name: 'Padel SaaS',
          description: 'Updated new desc',
          whyTheyBuy: '',
          typicalBuyer: [],
          typicalBuyerOther: '',
          customerSize: [],
          pricingModels: ['monthly_subscription'],
          pricing: { monthlyPrice: 180 },
          revenuePredictability: 'predictable',
        },
      ];

      const res = await syncSalesSettingsProductsToCatalog(mockDb, 'padel-africa', 'default', productLines, 'EUR');
      expect(res.created).toBe(0);
      expect(res.updated).toBe(1);
      expect(updatedDocs).toHaveLength(1);
      expect(updatedDocs[0].filter.id).toBe('prod-existing');
      expect(updatedDocs[0].update.$set.unitPrice).toBe(180);
      expect(updatedDocs[0].update.$set.description).toBe('Updated new desc');
    });
  });

  describe('syncCatalogProductToSalesSettings', () => {
    it('adds product line to sales settings when catalog product is created', async () => {
      const settingsDoc = {
        brand: 'padel-africa',
        tenantId: 'default',
        products: [],
      };

      let savedSettings: any = null;
      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          findOne: vi.fn().mockResolvedValue(settingsDoc),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            savedSettings = update.$set;
            return Promise.resolve({});
          }),
        }),
      };

      const newProduct: Product = {
        id: 'prod-new',
        brand: 'padel-africa',
        tenantId: 'default',
        name: 'Court Lighting Package',
        description: 'LED lights',
        unitPrice: 4500,
        currency: 'EUR',
        pricingModel: 'one_time',
        active: true,
        createdAt: '2026-10-29T10:00:00.000Z',
        updatedAt: '2026-10-29T10:00:00.000Z',
      };

      const res = await syncCatalogProductToSalesSettings(mockDb, 'padel-africa', 'default', newProduct, 'upsert');
      expect(res).toBe(true);
      expect(savedSettings.products).toHaveLength(1);
      expect(savedSettings.products[0].name).toBe('Court Lighting Package');
      expect(savedSettings.products[0].pricing.oneTimePrice).toBe(4500);
    });

    it('removes product line from sales settings when catalog product is deleted', async () => {
      const settingsDoc = {
        brand: 'padel-africa',
        tenantId: 'default',
        products: [
          {
            id: 'prod-delete-me',
            name: 'Old Package',
            pricing: { oneTimePrice: 100 },
          },
        ],
      };

      let savedSettings: any = null;
      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          findOne: vi.fn().mockResolvedValue(settingsDoc),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            savedSettings = update.$set;
            return Promise.resolve({});
          }),
        }),
      };

      const productToDelete: Product = {
        id: 'prod-delete-me',
        brand: 'padel-africa',
        tenantId: 'default',
        name: 'Old Package',
        description: '',
        unitPrice: 100,
        currency: 'EUR',
        pricingModel: 'one_time',
        active: true,
        createdAt: '',
        updatedAt: '',
      };

      const res = await syncCatalogProductToSalesSettings(mockDb, 'padel-africa', 'default', productToDelete, 'delete');
      expect(res).toBe(true);
      expect(savedSettings.products).toHaveLength(0);
    });
  });
});
