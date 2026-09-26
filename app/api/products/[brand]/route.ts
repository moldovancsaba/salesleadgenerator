import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../lib/brand'
import { getTenantId } from '../../../../lib/tenant'
import { sanitizeProduct, PRODUCTS_COLLECTION } from '../../../lib/products'
import type { Product } from '../../../lib/products'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'

// Issue #226: guarded by requireBrandAccessApi (SSO session with access to
// this brand, a matching scoped key, or the legacy key) — not requireApiKey,
// because the admin products page and the lead deals editor call this from
// the browser. It previously had no guard at all (issue #215 §17's posture,
// copied from sales-settings, which issue #226 also closed).
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
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;
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
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;
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
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
