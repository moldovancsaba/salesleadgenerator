import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { resolveBrand } from '../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../../lib/session';
import {
  getUserConnection,
  getActiveConnectionByProvider,
  getValidCredential,
} from '../../../../lib/integration-store';
import { fetchWithRetry } from '../../../../../lib/integration-http';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand: rawBrand } = await params;
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId')?.trim();
    const messageId = searchParams.get('messageId')?.trim();
    const attachmentId = searchParams.get('attachmentId')?.trim();
    const filename = searchParams.get('filename')?.trim() || 'attachment';
    const mimeType = searchParams.get('mimeType')?.trim() || 'application/octet-stream';

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    if (documentId) {
      const orClauses: any[] = [{ id: documentId }];
      if (ObjectId.isValid(documentId)) {
        try {
          orClauses.push({ _id: new ObjectId(documentId) });
        } catch {}
      }
      const doc = await db.collection('documents').findOne({
        $or: orClauses,
        brand,
      });
      if (!doc || !doc.base64Data) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      const buffer = Buffer.from(doc.base64Data, 'base64');
      const safeName = (doc.filename || doc.name || filename).replace(/["\r\n]/g, '_');
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': doc.mimeType || 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    if (!messageId || !attachmentId) {
      return NextResponse.json({ error: 'messageId and attachmentId (or documentId) are required' }, { status: 400 });
    }

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    let connection = userId ? await getUserConnection(db, userId, 'gmail') : null;
    if (!connection) {
      connection = await getActiveConnectionByProvider(db, brand, tenantId, 'gmail');
    }

    if (!connection) {
      return NextResponse.json({ error: 'No active Gmail connection available to download attachment' }, { status: 404 });
    }

    const token = await getValidCredential(db, connection);
    const gmailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    const res = await fetchWithRetry(gmailUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to retrieve attachment from Gmail' }, { status: 502 });
    }

    const payload = await res.json();
    if (!payload?.data) {
      return NextResponse.json({ error: 'Empty attachment payload' }, { status: 404 });
    }

    const base64Standard = String(payload.data).replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(base64Standard, 'base64');
    const safeFilename = filename.replace(/["\r\n]/g, '_');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error: any) {
    console.error('GET /api/inbox/[brand]/attachments Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to download attachment' }, { status: 500 });
  }
}
