import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb';
import { resolveBrand, type Brand } from '../../../lib/brand';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../lib/session';
import { getTodayViewData } from '../../../../lib/today-query';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand: rawBrand } = await params;
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const timezone = searchParams.get('timezone') || undefined;
    const rawScope = searchParams.get('scope') || 'mine';
    const scope: 'mine' | 'all' = rawScope === 'all' ? 'all' : 'mine';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    // Resolve rep user identity from SSO token if scope is 'mine'
    let userId: string | undefined;
    if (scope === 'mine') {
      const idToken = request.cookies.get('sso_id_token')?.value;
      const claims = await resolveSessionFromIdToken(idToken);
      userId = claims?.sub || claims?.email;
    }

    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();

    const data = await getTodayViewData(db, brand, {
      timezone,
      scope,
      userId,
      limit,
      tenantId,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('GET /api/today/[brand] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch Today view data' }, { status: 500 });
  }
}
