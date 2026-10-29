import type { Db } from 'mongodb';
import type { Product, PricingModel } from '../app/lib/products';
import { PRODUCTS_COLLECTION, resolveProductLinePrice, sanitizeProduct } from '../app/lib/products';
import type { ProductLine, SalesSettings } from '../app/lib/sales-settings';
import { catalogProductToProductLine } from '../app/lib/sales-settings';
import type { CurrencyCode } from '../app/lib/brand-constants';

const COMPANY_SETTINGS_COLLECTION = 'company_settings';

/**
 * Extracts the primary pricing model and unit price from a SalesSettings ProductLine.
 */
export function extractProductLinePrimaryPricing(line: ProductLine): { pricingModel: PricingModel; unitPrice: number } | null {
  const model = line.pricingModels?.[0] || 'one_time';
  const price = resolveProductLinePrice(line.pricing, model) ?? 0;
  if (!price || price <= 0) {
    // Check if any other pricing model has a valid price
    for (const altModel of line.pricingModels || []) {
      const altPrice = resolveProductLinePrice(line.pricing, altModel);
      if (altPrice && altPrice > 0) {
        return { pricingModel: altModel, unitPrice: altPrice };
      }
    }
    return null;
  }
  return { pricingModel: model, unitPrice: price };
}

/**
 * Direction 1: Synchronizes SalesSettings ProductLine[] offerings into the central `products` catalog collection.
 * Called automatically when `PUT /api/sales-settings/[brand]` is executed.
 */
export async function syncSalesSettingsProductsToCatalog(
  db: Db,
  brand: string,
  tenantId: string,
  productLines: ProductLine[],
  currency: CurrencyCode
): Promise<{ created: number; updated: number }> {
  if (!Array.isArray(productLines)) return { created: 0, updated: 0 };

  const productsColl = db.collection(PRODUCTS_COLLECTION);
  const existingCatalog = (await productsColl.find({ brand, tenantId }).toArray()) as unknown as Product[];
  const existingById = new Map<string, Product>();
  const existingByName = new Map<string, Product>();
  const existingBySourceLineId = new Map<string, Product>();

  for (const item of existingCatalog) {
    existingById.set(item.id, item);
    existingByName.set(item.name.trim().toLowerCase(), item);
    if (item.sourceProductLineId) {
      existingBySourceLineId.set(item.sourceProductLineId, item);
    }
  }

  let created = 0;
  let updated = 0;

  for (const line of productLines) {
    const cleanName = (line.name || '').trim();
    if (!cleanName) continue;

    const pricingInfo = extractProductLinePrimaryPricing(line);
    // If no positive price found, skip or default to 0 if valid
    const unitPrice = pricingInfo?.unitPrice ?? 0;
    const pricingModel = pricingInfo?.pricingModel ?? (line.pricingModels?.[0] || 'one_time');

    if (unitPrice <= 0) continue; // Catalog products require a valid positive unitPrice

    // Match existing catalog item
    const matched =
      existingById.get(line.id) ||
      existingBySourceLineId.get(line.id) ||
      existingByName.get(cleanName.toLowerCase());

    if (matched) {
      // Update existing catalog product
      const updatedDoc = sanitizeProduct(
        brand,
        tenantId,
        {
          id: matched.id,
          name: cleanName,
          description: line.description || matched.description || '',
          unitPrice,
          currency: matched.currency || currency,
          pricingModel,
          active: matched.active,
          sourceProductLineId: line.id,
        },
        { existing: matched }
      );

      if (updatedDoc) {
        await productsColl.updateOne(
          { brand, tenantId, id: matched.id },
          { $set: updatedDoc }
        );
        updated++;
      }
    } else {
      // Create new catalog product
      const newProduct = sanitizeProduct(
        brand,
        tenantId,
        {
          name: cleanName,
          description: line.description || '',
          unitPrice,
          currency,
          pricingModel,
          active: true,
          sourceProductLineId: line.id,
        }
      );

      if (newProduct) {
        await productsColl.insertOne(newProduct);
        created++;
      }
    }
  }

  return { created, updated };
}

/**
 * Direction 2: Synchronizes a single Product catalog mutation back into `company_settings.products`.
 * Called automatically when `POST`, `PATCH`, or `DELETE /api/products/[brand]/[productId]` is executed.
 */
export async function syncCatalogProductToSalesSettings(
  db: Db,
  brand: string,
  tenantId: string,
  product: Product,
  action: 'upsert' | 'delete'
): Promise<boolean> {
  const settingsColl = db.collection(COMPANY_SETTINGS_COLLECTION);
  const settingsDoc = (await settingsColl.findOne({ brand, tenantId })) as SalesSettings | null;

  if (!settingsDoc) {
    return false;
  }

  const existingProducts: ProductLine[] = Array.isArray(settingsDoc.products) ? [...settingsDoc.products] : [];
  const cleanName = product.name.trim().toLowerCase();

  const matchIdx = existingProducts.findIndex(
    (p) =>
      p.id === product.id ||
      p.id === product.sourceProductLineId ||
      (typeof p.name === 'string' && p.name.trim().toLowerCase() === cleanName)
  );

  if (action === 'delete') {
    if (matchIdx >= 0) {
      existingProducts.splice(matchIdx, 1);
      await settingsColl.updateOne(
        { brand, tenantId },
        {
          $set: {
            products: existingProducts,
            updatedAt: new Date().toISOString(),
          },
        }
      );
      return true;
    }
    return false;
  }

  // action === 'upsert'
  if (matchIdx >= 0) {
    const current = existingProducts[matchIdx];
    const updatedPricing = { ...current.pricing };

    if (product.pricingModel === 'one_time') updatedPricing.oneTimePrice = product.unitPrice;
    else if (product.pricingModel === 'monthly_subscription') updatedPricing.monthlyPrice = product.unitPrice;
    else if (product.pricingModel === 'annual_subscription') updatedPricing.annualPrice = product.unitPrice;
    else if (product.pricingModel === 'framework_agreement') updatedPricing.frameworkAnnualValue = product.unitPrice;
    else if (product.pricingModel === 'campaign_based') updatedPricing.campaignPrice = product.unitPrice;
    else if (product.pricingModel === 'per_user') {
      updatedPricing.perUserPrice = product.unitPrice;
      updatedPricing.perUserTypical = product.unitPrice;
    } else if (product.pricingModel === 'per_product') updatedPricing.perProductPrice = product.unitPrice;
    else if (product.pricingModel === 'per_event') updatedPricing.perEventPrice = product.unitPrice;
    else if (product.pricingModel === 'custom_quotation') updatedPricing.customQuotationTypicalValue = product.unitPrice;

    const pricingModels = current.pricingModels.includes(product.pricingModel)
      ? current.pricingModels
      : [...current.pricingModels, product.pricingModel];

    existingProducts[matchIdx] = {
      ...current,
      id: current.id || product.id,
      name: product.name,
      description: product.description || current.description || '',
      pricing: updatedPricing,
      pricingModels,
    };
  } else {
    // Add new product line to settings
    existingProducts.push(catalogProductToProductLine(product));
  }

  await settingsColl.updateOne(
    { brand, tenantId },
    {
      $set: {
        products: existingProducts,
        updatedAt: new Date().toISOString(),
      },
    }
  );

  return true;
}
