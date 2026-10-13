import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api';
import { getTenantId } from '../../../lib/tenant';
import { resolveBrand } from '../../lib/brand';
import type { Brand } from '../../lib/brand';
import {
  buildDocumentStorageKey,
  sanitizeDocumentFilename,
  validateDocumentMetadata,
  type DocumentRecord,
} from '../../../lib/documents';

export const dynamic = 'force-dynamic';

const COLLECTION = 'documents';

async function getBrand(request: Request, bodyBrand?: string): Promise<Brand | null> {
  const url = new URL(request.url);
  const rawBrand = (bodyBrand || url.searchParams.get('brand') || '').trim();
  return await resolveBrand(rawBrand);
}

function toResponseShape(doc: any): DocumentRecord {
  return {
    id: doc._id ? doc._id.toString() : doc.id,
    brand: doc.brand,
    tenantId: doc.tenantId,
    filename: doc.filename,
    displayName: doc.displayName || doc.filename,
    storageKey: doc.storageKey,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
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
      return NextResponse.json({ documents: [], total: 0, brand });
    }

    const client = await clientPromise;
    const db = client.db();
    const docs = await db
      .collection(COLLECTION)
      .find({ tenantId, brand })
      .sort({ createdAt: -1 })
      .toArray();

    const documents = docs.map(toResponseShape);
    return NextResponse.json({ documents, total: documents.length, brand });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to retrieve documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const brand = await getBrand(request, body.brand);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    const validation = validateDocumentMetadata({
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const docObjectId = new ObjectId();
    const docId = docObjectId.toString();
    const sanitizedFilename = sanitizeDocumentFilename(body.filename);
    const sanitizedDisplayName = body.displayName
      ? sanitizeDocumentFilename(body.displayName)
      : sanitizedFilename;

    const storageKey = buildDocumentStorageKey({
      brand,
      tenantId,
      documentId: docId,
      filename: sanitizedFilename,
    });

    const now = new Date();
    const docToInsert = {
      _id: docObjectId,
      id: docId,
      brand,
      tenantId,
      filename: sanitizedFilename,
      displayName: sanitizedDisplayName,
      storageKey,
      mimeType: body.mimeType.toLowerCase(),
      sizeBytes: body.sizeBytes,
      uploadedBy: typeof body.uploadedBy === 'string' ? body.uploadedBy.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection(COLLECTION).insertOne(docToInsert);

    return NextResponse.json(
      { ok: true, document: toResponseShape(docToInsert) },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }
}
