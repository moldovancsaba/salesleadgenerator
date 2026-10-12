import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '../../../lib/tenant';
import { getDefaultPipeline, sanitizePipeline } from '../../../lib/pipelines';
import type { Pipeline } from '../../../lib/pipelines';
import { resolveBrand } from '../../lib/brand';
import type { Brand } from '../../lib/brand';

export const dynamic = 'force-dynamic';

const COLLECTION = 'pipelines';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  return await resolveBrand((url.searchParams.get('brand') || '').trim());
}

function toResponseShape(doc: any): Pipeline {
  return {
    id: doc.id || doc._id.toString(),
    brand: doc.brand,
    tenantId: doc.tenantId,
    name: doc.name,
    description: doc.description,
    isDefault: doc.isDefault === true,
    stages: Array.isArray(doc.stages) ? doc.stages : [],
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      const defaultPipe = getDefaultPipeline(brand, tenantId);
      return NextResponse.json({ pipelines: [defaultPipe], total: 1, brand });
    }

    const client = await clientPromise;
    const db = client.db();

    const docs = await db
      .collection(COLLECTION)
      .find({ brand, ...tenantFilter(tenantId) })
      .sort({ isDefault: -1, name: 1 })
      .toArray();

    let pipelines = docs.map(toResponseShape);

    // If no pipelines configured in DB, provide the canonical default pipeline
    if (pipelines.length === 0) {
      pipelines = [getDefaultPipeline(brand, tenantId)];
    }

    return NextResponse.json({ pipelines, total: pipelines.length, brand });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const sanitized = sanitizePipeline({ ...body, brand, tenantId });
    if (!sanitized) {
      return NextResponse.json({ error: 'Invalid pipeline configuration' }, { status: 400 });
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ pipeline: sanitized, success: true });
    }

    const client = await clientPromise;
    const db = client.db();

    // If setting as default, unmark any existing default pipeline for this brand/tenant
    if (sanitized.isDefault) {
      await db.collection(COLLECTION).updateMany(
        { brand, ...tenantFilter(tenantId), id: { $ne: sanitized.id } },
        { $set: { isDefault: false, updatedAt: new Date().toISOString() } }
      );
    }

    await db.collection(COLLECTION).updateOne(
      { id: sanitized.id, brand, ...tenantFilter(tenantId) },
      { $set: sanitized },
      { upsert: true }
    );

    return NextResponse.json({ pipeline: sanitized, success: true }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to save pipeline' }, { status: 500 });
  }
}
