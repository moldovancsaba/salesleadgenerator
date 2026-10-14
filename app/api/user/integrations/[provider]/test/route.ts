import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { getUserConnection, getValidCredential, ConnectionRevokedError } from '@/app/lib/integration-store';
import { isKnownProvider, type IntegrationProvider } from '@/lib/integration-connections';

// Issue #247: Self-service endpoint for a logged-in rep to test their
// personal integration connection (e.g. personal Gmail).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerParam } = await params;
  if (!isKnownProvider(providerParam)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }

  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const connection = await getUserConnection(db, claims.sub, providerParam as IntegrationProvider);

  if (!connection) {
    return NextResponse.json({ error: 'No active connection found for this provider' }, { status: 404 });
  }

  try {
    await getValidCredential(db, connection);
    const now = new Date().toISOString();
    await db.collection('integration_connections').updateOne(
      { id: connection.id },
      { $set: { lastVerifiedAt: now, status: 'active', updatedAt: now }, $unset: { lastSyncError: '' } }
    );
    return NextResponse.json({ ok: true, status: 'active', lastVerifiedAt: now });
  } catch (err: any) {
    const errorMsg = err instanceof ConnectionRevokedError ? err.message : (err?.message || 'Verification failed');
    return NextResponse.json({ ok: false, status: 'error', error: errorMsg }, { status: 400 });
  }
}

export const dynamic = 'force-dynamic';
