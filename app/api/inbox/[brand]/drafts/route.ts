import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import { resolveSessionFromIdToken } from '@/lib/session';
import { listUserGmailDrafts, sendUserGmailDraft } from '@/lib/gmail-drafts';

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

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;
    const userEmail = claims?.email;

    if (!userId) {
      return NextResponse.json({ connected: false, drafts: [], count: 0 });
    }

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await listUserGmailDrafts(db, brand, tenantId, { userId, userEmail });
    return NextResponse.json({
      brand,
      tenantId,
      connected: result.connected,
      count: result.drafts.length,
      drafts: result.drafts,
      ...(result.errors ? { errors: result.errors } : {}),
    });
  } catch (error: any) {
    console.error('GET /api/inbox/[brand]/drafts Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load Gmail drafts' }, { status: 500 });
  }
}

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

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const userId = claims?.sub || claims?.email;
    const userEmail = claims?.email;
    const userName = claims?.name || claims?.email?.split('@')[0];

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await sendUserGmailDraft(
      db,
      brand,
      tenantId,
      {
        draftId: body.draftId,
        connectionId: body.connectionId,
        to: body.to,
        cc: body.cc,
        subject: body.subject,
        body: body.body,
        unchanged: body.unchanged === true,
        includeSignature: body.includeSignature,
        senderEmail: body.senderEmail,
        threadId: body.threadId,
        inReplyTo: body.inReplyTo,
        references: body.references,
        matchedLeadId: body.matchedLeadId,
      },
      { userId, userEmail, userName }
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || 'Failed to send draft' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('POST /api/inbox/[brand]/drafts Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to send Gmail draft' }, { status: 500 });
  }
}
