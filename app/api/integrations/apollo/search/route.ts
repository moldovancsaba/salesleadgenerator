import { NextRequest, NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import { getActiveConnectionByProvider, getValidCredential } from '@/app/lib/integration-store';
import { searchApolloContacts } from '@/lib/apollo-import';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const rawBrand = body.brand || new URL(request.url).searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(rawBrand);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = body.tenantId || getTenantId(request) || 'default';
    const client = await clientPromise;
    const db = client.db();

    const connection =
      (await getActiveConnectionByProvider(db, brand, tenantId, 'apollo')) ||
      (tenantId !== 'default' ? await getActiveConnectionByProvider(db, brand, 'default', 'apollo') : null);

    if (!connection || connection.status !== 'active') {
      return NextResponse.json(
        { error: 'Apollo is not connected for this workspace. Connect an Apollo API key first.' },
        { status: 400 }
      );
    }

    const apiKey = await getValidCredential(db, connection);
    const mode = body.mode === 'global_search' ? 'global_search' : 'saved_contacts';
    const query = typeof body.query === 'string' ? body.query : '';
    const page = typeof body.page === 'number' ? body.page : 1;
    const perPage = typeof body.perPage === 'number' ? body.perPage : 25;

    const result = await searchApolloContacts(apiKey, { query, mode, page, perPage });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error || 'Apollo search failed',
          entitlementBlocked: result.entitlementBlocked,
          modeUsed: result.modeUsed,
        },
        { status: result.entitlementBlocked ? 403 : 502 }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API:integrations/apollo/search] POST error:', error);
    return NextResponse.json({ error: 'Failed to search Apollo contacts' }, { status: 500 });
  }
}
