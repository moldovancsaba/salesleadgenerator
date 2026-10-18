import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../../lib/mongodb';
import { resolveBrand } from '../../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../../../lib/session';
import {
  getInboxThreadDetail,
  setThreadStatus,
  postInboxReply,
  type InboxReplyPayload,
} from '../../../../../lib/inbox-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string; id: string }> }
) {
  try {
    const { brand: rawBrand, id: threadId } = await params;
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
    const markRead = searchParams.get('markRead') !== 'false';

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const detail = await getInboxThreadDetail(db, brand, tenantId, decodeURIComponent(threadId), {
      userId,
      markRead,
    });

    if (!detail.thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({
      brand,
      tenantId,
      ...detail,
    });
  } catch (error: any) {
    console.error('GET /api/inbox/[brand]/threads/[id] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to get thread detail' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string; id: string }> }
) {
  try {
    const { brand: rawBrand, id: threadId } = await params;
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const updates = await request.json().catch(() => ({}));
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await setThreadStatus(db, brand, tenantId, decodeURIComponent(threadId), updates, userId);

    return NextResponse.json({
      success: true,
      state: result,
    });
  } catch (error: any) {
    console.error('PATCH /api/inbox/[brand]/threads/[id] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to update thread state' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string; id: string }> }
) {
  try {
    const { brand: rawBrand, id: threadId } = await params;
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const payload = (await request.json().catch(() => ({}))) as InboxReplyPayload;
    if (!payload || !payload.kind) {
      return NextResponse.json({ error: 'Payload kind ("email" or "note") is required' }, { status: 400 });
    }

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userEmail = claims?.email;
    const userName = claims?.name || claims?.email?.split('@')[0];
    const userId = claims?.sub || claims?.email;

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await postInboxReply(
      db,
      brand,
      tenantId,
      decodeURIComponent(threadId),
      payload,
      { userId, userEmail, userName }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to process reply' }, { status: 400 });
    }

    return NextResponse.json({
      ...result,
    });
  } catch (error: any) {
    console.error('POST /api/inbox/[brand]/threads/[id] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to post reply' }, { status: 500 });
  }
}
