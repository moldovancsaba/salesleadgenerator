import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { markTourSeen } from '@/lib/sso-access';

// Issue #185 — self-service: any logged-in user marks their own onboarding
// tour as seen. Deliberately uses resolveSessionFromIdToken directly rather
// than requireSuperAdminSession (admin-only, wrong gate) or
// requireApiKeyOrSession (discards the verified claims on success, but this
// route needs claims.sub to know whose record to update).
export async function POST(request: NextRequest) {
  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  await markTourSeen(client.db(), claims.sub);

  return NextResponse.json({ ok: true });
}
