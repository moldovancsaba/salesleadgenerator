import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { isCronRequest } from '@/lib/api-auth';
import { getTenantId } from '@/lib/tenant';
import { backfillMarketingOptInLeadsToEngaged } from '@/lib/landing-engaged-backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      brand?: string;
      dryRun?: boolean;
      limit?: number;
    };

    const rawBrand = typeof body.brand === 'string' ? body.brand.trim() : '';
    if (!rawBrand) {
      return NextResponse.json({ error: 'brand is required' }, { status: 400 });
    }

    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    if (!isCronRequest(request)) {
      const authError = await requireBrandAccessApi(request, brand);
      if (authError) return authError;
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
    }

    const brandConfig = await getBrandConfig(brand);
    if (!brandConfig) {
      return NextResponse.json({ error: 'Brand configuration not found' }, { status: 404 });
    }

    const tenantId = getTenantId(request);
    const client = await clientPromise;
    const db = client.db();

    const result = await backfillMarketingOptInLeadsToEngaged({
      db,
      brand,
      dbCollection: brandConfig.dbCollection,
      tenantId,
      dryRun: body.dryRun === true,
      limit: typeof body.limit === 'number' ? body.limit : 250,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API:admin/landing-engaged-backfill] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to backfill engaged leads' },
      { status: 500 }
    );
  }
}
