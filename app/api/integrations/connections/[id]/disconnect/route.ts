import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../../lib/mongodb';
import { requireBrandAccessSession } from '../../../../../../lib/require-brand-session';
import { getConnectionById, disconnectConnection } from '../../../../../lib/integration-store';

// Issue #217 — best-effort remote revoke, unconditional local
// status: 'revoked' regardless of whether the remote call succeeds
// (app/lib/integration-store.ts's disconnectConnection()). The id alone
// doesn't identify a brand, so the connection is read first (no access
// check yet — its brand is not yet known) and requireBrandAccessSession is
// checked against ITS brand, never a client-supplied one.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const client = await clientPromise;
  const db = client.db();
  const connection = await getConnectionById(db, id);
  if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const claimsOrResponse = await requireBrandAccessSession(request, connection.brand);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  await disconnectConnection(db, connection);
  return NextResponse.json({ revoked: true });
}

export const dynamic = 'force-dynamic';
