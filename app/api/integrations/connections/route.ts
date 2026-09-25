import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessSession } from '../../../../lib/require-brand-session';
import { resolveBrand } from '../../../lib/brand';
import { getTenantId } from '../../../../lib/tenant';
import { listConnections } from '../../../lib/integration-store';

// Issue #217 — lists this brand/tenant's integration connections. Never
// returns encryptedCredentials (app/lib/integration-store.ts's toSafe()
// strips it unconditionally). Session-only (requireBrandAccessSession) —
// deliberately never x-api-key-accessible, same "a credential-management
// surface must never be reachable by a credential it itself manages" rule
// as issue #210 §17.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const claimsOrResponse = await requireBrandAccessSession(request, brand);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();
  const connections = await listConnections(db, brand, tenantId);

  return NextResponse.json({ connections, brand, tenantId });
}

export const dynamic = 'force-dynamic';
