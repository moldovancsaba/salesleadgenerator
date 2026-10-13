import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveBrand } from '../../../lib/brand';
import type { Brand } from '../../../lib/brand';
import {
  canDeleteDocument,
  type DocumentReferenceConsumer,
} from '../../../../lib/documents';

export const dynamic = 'force-dynamic';

const COLLECTION = 'documents';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  return await resolveBrand((url.searchParams.get('brand') || '').trim());
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const { id } = await params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    let queryId: any = id;
    try {
      if (ObjectId.isValid(id)) {
        queryId = { $in: [id, new ObjectId(id)] };
      }
    } catch {
      queryId = id;
    }

    const existingDoc = await db.collection(COLLECTION).findOne({
      $or: [
        { _id: typeof queryId === 'object' && queryId.$in ? queryId : id },
        { id: id },
      ],
      brand,
      tenantId,
    });

    if (!existingDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // CRM Invariant / Predecessor Handoff 11 (issue #243): Deletion safety guard.
    // Check if document is referenced by any active cadence steps or templates.
    const referencingCadences = await db
      .collection('cadences')
      .find({
        brand,
        tenantId,
        'steps.documentIds': id,
      })
      .toArray();

    const referencingTemplates = await db
      .collection('outreach_templates')
      .find({
        brand,
        tenantId,
        documentIds: id,
      })
      .toArray();

    const consumers: DocumentReferenceConsumer[] = [
      ...referencingCadences.map((c: any) => ({
        kind: 'cadence' as const,
        id: c._id ? c._id.toString() : c.id,
        name: c.name || 'Cadence',
      })),
      ...referencingTemplates.map((t: any) => ({
        kind: 'template' as const,
        id: t._id ? t._id.toString() : t.id,
        name: t.name || 'Template',
      })),
    ];

    const deleteCheck = canDeleteDocument(id, consumers);
    if (!deleteCheck.allowed) {
      return NextResponse.json(
        {
          error: 'document_in_use',
          message: deleteCheck.error,
          inUseBy: deleteCheck.inUseBy,
        },
        { status: 409 }
      );
    }

    await db.collection(COLLECTION).deleteOne({ _id: existingDoc._id });

    return NextResponse.json({ ok: true, deleted: true, documentId: id });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
