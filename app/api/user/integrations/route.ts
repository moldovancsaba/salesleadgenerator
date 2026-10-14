import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { listUserConnections, getUserConnection } from '@/app/lib/integration-store';
import type { IntegrationProvider } from '@/lib/integration-connections';

// Issue #247: Self-service endpoint for a logged-in rep to list their own
// personal integrations (e.g. personal Gmail connection).
export async function GET(request: NextRequest) {
  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const connections = await listUserConnections(client.db(), claims.sub);

  return NextResponse.json({ connections });
}

export const dynamic = 'force-dynamic';
