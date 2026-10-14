import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { syncUserGmailSignature } from '@/lib/gmail-signature';

// Issue #241: Self-service endpoint for a logged-in rep to synchronize their
// primary Gmail signature from Google settings.
export async function POST(request: NextRequest) {
  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();

  const result = await syncUserGmailSignature(db, claims.sub);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || 'Failed to sync signature' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    signatureText: result.signatureText,
    signatureSyncedAt: result.signatureSyncedAt,
  });
}

export const dynamic = 'force-dynamic';
