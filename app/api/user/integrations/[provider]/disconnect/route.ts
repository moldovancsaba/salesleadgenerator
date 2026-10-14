import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { disconnectUserConnection } from '@/app/lib/integration-store';
import { isKnownProvider, type IntegrationProvider } from '@/lib/integration-connections';

// Issue #247: Self-service endpoint for a logged-in rep to disconnect their
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
  const disconnected = await disconnectUserConnection(client.db(), claims.sub, providerParam as IntegrationProvider);

  if (!disconnected) {
    return NextResponse.json({ error: 'No active connection found for this provider' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
