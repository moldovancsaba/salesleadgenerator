import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '../../../../lib/tenant';
import { canDeletePipeline, sanitizePipeline } from '../../../../lib/pipelines';
import type { Pipeline } from '../../../../lib/pipelines';
import { getBrandConfig, resolveBrand } from '../../../lib/brand';
import type { Brand } from '../../../lib/brand';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const client = await clientPromise;
    const db = client.db();

    const doc = await db.collection(COLLECTION).findOne({ id, brand, ...tenantFilter(tenantId) });
    if (!doc) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    return NextResponse.json({ pipeline: toResponseShape(doc) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to fetch pipeline' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const existingDoc = await db.collection(COLLECTION).findOne({ id, brand, ...tenantFilter(tenantId) });
    if (!existingDoc) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const existing = toResponseShape(existingDoc);
    const sanitized = sanitizePipeline({ ...existing, ...body, id, brand, tenantId }, existing);
    if (!sanitized) {
      return NextResponse.json({ error: 'Invalid pipeline configuration' }, { status: 400 });
    }

    // If making this pipeline default, unmark other pipelines
    if (sanitized.isDefault && !existing.isDefault) {
      await db.collection(COLLECTION).updateMany(
        { brand, ...tenantFilter(tenantId), id: { $ne: id } },
        { $set: { isDefault: false, updatedAt: new Date().toISOString() } }
      );
    }

    await db.collection(COLLECTION).updateOne(
      { id, brand, ...tenantFilter(tenantId) },
      { $set: sanitized }
    );

    return NextResponse.json({ pipeline: sanitized, success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const doc = await db.collection(COLLECTION).findOne({ id, brand, ...tenantFilter(tenantId) });
    if (!doc) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const pipeline = toResponseShape(doc);

    // Count active deals/leads in this pipeline
    const config = await getBrandConfig(brand);
    let activeDealCount = 0;
    if (config?.dbCollection) {
      activeDealCount = await db.collection(config.dbCollection).countDocuments({
        ...tenantFilter(tenantId),
        $or: [
          { 'deals.pipelineId': id },
          { pipelineId: id },
        ],
      });
    }

    const check = canDeletePipeline(pipeline, activeDealCount);
    if (!check.canDelete) {
      const status = pipeline.isDefault ? 400 : 409;
      return NextResponse.json({ error: check.reason }, { status });
    }

    await db.collection(COLLECTION).deleteOne({ id, brand, ...tenantFilter(tenantId) });

    return NextResponse.json({ success: true, deleted: id });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 });
  }
}
