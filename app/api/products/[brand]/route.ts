import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../lib/brand'
import { getTenantId } from '../../../../lib/tenant'
import { sanitizeProduct } from '../../../lib/products'
import type { Product } from '../../../lib/products'

export const PRODUCTS_COLLECTION = 'products'

// Deliberately no requireApiKey guard — same posture already recorded for
// GET/PUT /api/sales-settings/[brand] (issue #215 §17): this is
// browser-writable, brand-scoped commercial configuration a logged-in-context
// rep edits directly, not lead/contact PII.
let indexEnsured = false;
async function ensureProductsIndex(db: any): Promise<void> {
  if (indexEnsured) return;
  try {
    await db.collection(PRODUCTS_COLLECTION).createIndex({ brand: 1, tenantId: 1, id: 1 }, { unique: true });
    indexEnsured = true;
  } catch {
    // Best-effort — a transient failure here just means the next call retries.
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

    const client = await getClientPromise();
    const db = client.db();
    const products = await db.collection(PRODUCTS_COLLECTION)
      .find({ brand, tenantId })
      .sort({ name: 1 })
      .toArray();

    return NextResponse.json({ products: products as unknown as Product[], brand, tenantId });
  } catch (error: any) {
    console.error('GET /api/products/[brand] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch products', details: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const product = sanitizeProduct(brand, tenantId, body);
    if (!product) {
      return NextResponse.json({ error: 'name, unitPrice, and a valid pricingModel are required' }, { status: 400 });
    }

    const client = await getClientPromise();
    const db = client.db();
    await ensureProductsIndex(db);
    await db.collection(PRODUCTS_COLLECTION).insertOne(product);

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/products/[brand] Error:', error)
    return NextResponse.json({ error: 'Failed to create product', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
