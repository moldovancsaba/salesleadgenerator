import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { resolveBrand } from '../../../lib/brand';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../lib/session';
import {
  listInboxThreads,
  setThreadStatus,
  type InboxStream,
} from '../../../lib/inbox-store';

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
    const stream = (searchParams.get('stream') || 'inbox') as InboxStream;
    const search = searchParams.get('search') || undefined;
    const starredOnly = searchParams.get('starred') === 'true';
    const unreadOnly = searchParams.get('unread') === 'true';
    const archivedOnly = searchParams.get('archived') === 'true';
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await listInboxThreads(db, brand, tenantId, {
      stream,
      search,
      starredOnly,
      unreadOnly,
      archivedOnly,
      userId,
      limit,
      offset,
    });

    return NextResponse.json({
      brand,
      tenantId,
      ...result,
    });
  } catch (error: any) {
    console.error('GET /api/inbox/[brand] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to list inbox threads' }, { status: 500 });
  }
}

export async function PATCH(
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

    const body = await request.json().catch(() => ({}));
    const { threadIds, updates } = body;

    if (!Array.isArray(threadIds) || threadIds.length === 0 || !updates) {
      return NextResponse.json({ error: 'threadIds array and updates object are required' }, { status: 400 });
    }

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const results = await Promise.all(
      threadIds.map((tid: string) => setThreadStatus(db, brand, tenantId, tid, updates, userId))
    );

    return NextResponse.json({
      success: true,
      updatedCount: results.length,
    });
  } catch (error: any) {
    console.error('PATCH /api/inbox/[brand] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to update threads' }, { status: 500 });
  }
}
