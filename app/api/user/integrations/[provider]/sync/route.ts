import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { isKnownProvider } from '@/lib/integration-connections';
import { pollUserGmail } from '@/app/lib/gmail-sync-store';

// Issue #249: Self-service endpoint for a logged-in sales rep to trigger an immediate
// sync of their connected Gmail account without waiting for the hourly cron tick.
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

  if (providerParam !== 'gmail') {
    return NextResponse.json({ error: 'Sync not supported for this provider' }, { status: 400 });
  }

  const url = new URL(request.url);
  const brand = url.searchParams.get('brand') || undefined;
  const connectionId = url.searchParams.get('id') || undefined;

  const client = await clientPromise;
  const db = client.db();

  const result = await pollUserGmail(db, claims.sub, brand, connectionId);

  if (result.failure && result.ingested === 0 && result.skipped === 0) {
    return NextResponse.json({ ok: false, error: result.failure }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    ingested: result.ingested,
    skipped: result.skipped,
    failure: result.failure,
  });
}

export const dynamic = 'force-dynamic';
