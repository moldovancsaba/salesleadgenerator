import { NextResponse, type NextRequest } from 'next/server';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import {
  saveLandingPage,
  deleteLandingPage,
} from '@/lib/landing-page-store';

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await resolveLandingBrand(request);
    if (brand instanceof NextResponse) return brand;
    const tenantId = getTenantId(request);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const saved = await saveLandingPage({
      ...body,
      id,
      brand,
      tenantId,
    });

    return NextResponse.json({ page: saved });
  } catch (err: any) {
    console.error('[API:landing-pages/[id]] PUT error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to update landing page' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const brand = await resolveLandingBrand(request);
    if (brand instanceof NextResponse) return brand;
    const { id } = await params;

    const ok = await deleteLandingPage(id, brand);
    if (!ok) {
      return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err: any) {
    console.error('[API:landing-pages/[id]] DELETE error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to delete landing page' }, { status: 500 });
  }
}
