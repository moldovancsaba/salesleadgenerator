import { NextResponse, type NextRequest } from 'next/server';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import {
  getLandingPagesForBrand,
  saveLandingPage,
} from '@/lib/landing-page-store';
import { LandingPageRecord } from '@/lib/landing-page-schema';

export const dynamic = 'force-dynamic';

async function resolveLandingBrand(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get('brand') || '').trim();
  if (!raw) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const brand = await resolveBrand(raw);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;
  return brand;
}

export async function GET(request: NextRequest) {
  try {
    const brand = await resolveLandingBrand(request);
    if (brand instanceof NextResponse) return brand;
    const tenantId = getTenantId(request);

    const pages = await getLandingPagesForBrand(brand, tenantId);
    return NextResponse.json({ pages, brand });
  } catch (err: any) {
    console.error('[API:landing-pages] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch landing pages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const brand = await resolveLandingBrand(request);
    if (brand instanceof NextResponse) return brand;
    const tenantId = getTenantId(request);

    const body = await request.json().catch(() => ({}));
    if (!body.title || !body.slug) {
      return NextResponse.json({ error: 'Title and URL slug are required' }, { status: 400 });
    }

    const saved = await saveLandingPage({
      ...body,
      brand,
      tenantId,
    });

    return NextResponse.json({ page: saved }, { status: 201 });
  } catch (err: any) {
    console.error('[API:landing-pages] POST error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to create landing page' }, { status: 500 });
  }
}
