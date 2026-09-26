import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../../lib/brand'
import { getTenantId, tenantFilter } from '../../../../../lib/tenant'
import { sanitizeProduct, PRODUCTS_COLLECTION } from '../../../../lib/products'
import type { Product } from '../../../../lib/products'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ brand: string; productId: string }> }) {
  try {
    const { brand: brandParam, productId } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

    const client = await getClientPromise();
    const db = client.db();
    const existing = (await db.collection(PRODUCTS_COLLECTION).findOne({ brand, tenantId, id: productId })) as Product | null;
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    // A partial PATCH must keep every field the caller didn't send — merge
    // onto the existing document before sanitizing, same convention as
    // every other partial-update route in this codebase.
    const merged = { ...existing, ...body, id: existing.id };
    const product = sanitizeProduct(brand, tenantId, merged, { existing });
    if (!product) {
      return NextResponse.json({ error: 'name, unitPrice, and a valid pricingModel are required' }, { status: 400 });
    }

    await db.collection(PRODUCTS_COLLECTION).updateOne({ brand, tenantId, id: productId }, { $set: product });
    return NextResponse.json({ product });
  } catch (error: any) {
    console.error('PATCH /api/products/[brand]/[productId] Error:', error)
    return NextResponse.json({ error: 'Failed to update product', details: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ brand: string; productId: string }> }) {
  try {
    const { brand: brandParam, productId } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

    const client = await getClientPromise();
    const db = client.db();
    const existing = await db.collection(PRODUCTS_COLLECTION).findOne({ brand, tenantId, id: productId });
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Issue #215 §10/§15 #6 — a product still referenced by any deal's
    // lineItems is never deleted outright; the operator must deactivate
    // instead so historical deals keep a resolvable productId.
    const referencingLeads = await db.collection(config.dbCollection)
      .find({ $and: [tenantFilter(tenantId), { 'deals.lineItems.productId': productId }] }, { projection: { _id: 1 } })
      .limit(50)
      .toArray();

    if (referencingLeads.length > 0) {
      return NextResponse.json({
        error: `Product is referenced by ${referencingLeads.length} existing deal(s)`,
        dealIds: referencingLeads.map((l: any) => l._id.toString()),
      }, { status: 409 });
    }

    await db.collection(PRODUCTS_COLLECTION).deleteOne({ brand, tenantId, id: productId });
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('DELETE /api/products/[brand]/[productId] Error:', error)
    return NextResponse.json({ error: 'Failed to delete product', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
