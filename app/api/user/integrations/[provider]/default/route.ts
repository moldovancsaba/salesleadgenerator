import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { setUserDefaultConnection } from '@/app/lib/integration-store';
import { isKnownProvider, type IntegrationProvider } from '@/lib/integration-connections';

// Issue #252: Endpoint for a rep to set their preferred default Google account for a provider.
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

  const body = await request.json().catch(() => ({}));
  const connectionId = typeof body.id === 'string' ? body.id.trim() : '';
  if (!connectionId) {
    return NextResponse.json({ error: 'Connection id is required' }, { status: 400 });
  }

  const client = await clientPromise;
  const updated = await setUserDefaultConnection(client.db(), claims.sub, providerParam as IntegrationProvider, connectionId);

  if (!updated) {
    return NextResponse.json({ error: 'Connection not found or not active' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: connectionId });
}

export const dynamic = 'force-dynamic';
