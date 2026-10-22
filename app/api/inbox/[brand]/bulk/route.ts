import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { resolveBrand } from '../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../../lib/session';
import { bulkSetThreadStatus } from '../../../../lib/inbox-store';

export const dynamic = 'force-dynamic';

export async function POST(
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
    const threadIds = Array.isArray(body.threadIds) ? body.threadIds : [];
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};

    if (threadIds.length === 0) {
      return NextResponse.json({ error: 'threadIds must be a non-empty array' }, { status: 400 });
    }

    const cleanUpdates: { isRead?: boolean; isStarred?: boolean; isArchived?: boolean } = {};
    if (typeof updates.isRead === 'boolean') cleanUpdates.isRead = updates.isRead;
    if (typeof updates.isStarred === 'boolean') cleanUpdates.isStarred = updates.isStarred;
    if (typeof updates.isArchived === 'boolean') cleanUpdates.isArchived = updates.isArchived;

    if (Object.keys(cleanUpdates).length === 0) {
      return NextResponse.json({ error: 'At least one state update (isRead, isStarred, isArchived) is required' }, { status: 400 });
    }

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await bulkSetThreadStatus(db, brand, tenantId, threadIds, cleanUpdates, userId);

    return NextResponse.json({
      ok: true,
      updatedCount: result.updatedCount,
    });
  } catch (error: any) {
    console.error('POST /api/inbox/[brand]/bulk Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to bulk update threads' }, { status: 500 });
  }
}
