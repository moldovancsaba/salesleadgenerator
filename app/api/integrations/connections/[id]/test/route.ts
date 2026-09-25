import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../../lib/mongodb';
import { requireBrandAccessSession } from '../../../../../../lib/require-brand-session';
import { getConnectionById, testConnection } from '../../../../../lib/integration-store';

// Issue #217 — re-verifies a stored connection against the real provider.
// A revoked-at-the-provider connection surfaces as status: 'error' on the
// next Test, never a silent pass.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const client = await clientPromise;
  const db = client.db();
  const connection = await getConnectionById(db, id);
  if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const claimsOrResponse = await requireBrandAccessSession(request, connection.brand);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const result = await testConnection(db, connection);
  return NextResponse.json(result);
}

export const dynamic = 'force-dynamic';
