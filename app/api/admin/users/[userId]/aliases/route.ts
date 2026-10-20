import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { setUserAliases, getUserAccess } from '@/lib/sso-access';

// Issue 271: Admin-managed linked mailbox aliases for SSO users.
// Super-admin only, session-based.
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const { userId } = await params;
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const record = await getUserAccess(db, userId);
  if (!record) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    ssoUserId: record.ssoUserId,
    email: record.email,
    aliases: record.aliases || [],
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const { userId } = await params;
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.aliases)) {
    return NextResponse.json({ error: 'aliases must be an array of email strings' }, { status: 400 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const updated = await setUserAliases(db, userId, body.aliases);

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    ssoUserId: updated.ssoUserId,
    email: updated.email,
    aliases: updated.aliases || [],
  });
}
