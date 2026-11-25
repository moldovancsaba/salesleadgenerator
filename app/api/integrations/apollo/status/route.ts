import { NextRequest, NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import { getActiveConnectionByProvider, getValidCredential } from '@/app/lib/integration-store';
import { APOLLO_PREREQUISITES, checkApolloEntitlements } from '@/lib/apollo-import';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const brand = await resolveBrand(searchParams.get('brand') || 'cogmap');
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const connection =
      (await getActiveConnectionByProvider(db, brand, tenantId, 'apollo')) ||
      (tenantId !== 'default' ? await getActiveConnectionByProvider(db, brand, 'default', 'apollo') : null);

    if (!connection || connection.status !== 'active') {
      return NextResponse.json({
        connected: false,
        prerequisites: APOLLO_PREREQUISITES,
      });
    }

    const verifyLive = searchParams.get('verify') === '1' || searchParams.get('verify') === 'true';
    if (!verifyLive) {
      return NextResponse.json({
        connected: true,
        connectionId: connection.id,
        providerAccountLabel: connection.providerAccountLabel || 'Apollo Workspace',
        lastVerifiedAt: connection.lastVerifiedAt,
        prerequisites: APOLLO_PREREQUISITES,
      });
    }

    const apiKey = await getValidCredential(db, connection);
    const entitlements = await checkApolloEntitlements(apiKey);
    return NextResponse.json({
      connected: true,
      connectionId: connection.id,
      providerAccountLabel: connection.providerAccountLabel || 'Apollo Workspace',
      lastVerifiedAt: connection.lastVerifiedAt,
      entitlements,
      prerequisites: APOLLO_PREREQUISITES,
    });
  } catch (error: any) {
    console.error('[API:integrations/apollo/status] GET error:', error);
    return NextResponse.json({ error: 'Failed to check Apollo status' }, { status: 500 });
  }
}
