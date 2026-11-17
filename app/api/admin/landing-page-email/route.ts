import { NextResponse, type NextRequest } from 'next/server';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { isCronRequest } from '@/lib/api-auth';
import { getTenantId } from '@/lib/tenant';
import { getLandingPageBySlug, saveLandingPage } from '@/lib/landing-page-store';
import {
  patchConfirmationEmailConfig,
  type LandingPageConfirmationEmailConfig,
} from '@/lib/landing-page-schema';

export const dynamic = 'force-dynamic';

async function resolveAuthorizedContext(request: NextRequest, rawBrand: string) {
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
  return brand;
}

export async function GET(request: NextRequest) {
  try {
    const rawBrand = (request.nextUrl.searchParams.get('brand') || '').trim();
    const slug = (request.nextUrl.searchParams.get('slug') || '').trim();
    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const brand = await resolveAuthorizedContext(request, rawBrand);
    if (brand instanceof NextResponse) return brand;

    const tenantId = getTenantId(request);
    const page = await getLandingPageBySlug(brand, slug, tenantId);
    if (!page) {
      return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: page.id,
      brand: page.brand,
      slug: page.slug,
      updatedAt: page.updatedAt,
      confirmationEmail: page.confirmationEmail || null,
    });
  } catch (err: any) {
    console.error('[API:admin/landing-page-email] GET error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to read confirmation email config' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      brand?: string;
      slug?: string;
      clearCtaBanner?: boolean;
      confirmationEmail?: Partial<LandingPageConfirmationEmailConfig>;
    };

    const rawBrand = typeof body.brand === 'string' ? body.brand.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const brand = await resolveAuthorizedContext(request, rawBrand);
    if (brand instanceof NextResponse) return brand;

    const tenantId = getTenantId(request);
    const page = await getLandingPageBySlug(brand, slug, tenantId);
    if (!page) {
      return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
    }

    const nextEmailConfig = patchConfirmationEmailConfig(page.confirmationEmail, {
      ...(body.confirmationEmail || {}),
      clearCtaBanner: body.clearCtaBanner === true,
    });

    const saved = await saveLandingPage({
      ...page,
      confirmationEmail: nextEmailConfig,
    });

    return NextResponse.json({
      id: saved.id,
      brand: saved.brand,
      slug: saved.slug,
      updatedAt: saved.updatedAt,
      confirmationEmail: saved.confirmationEmail || null,
    });
  } catch (err: any) {
    console.error('[API:admin/landing-page-email] PATCH error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to update confirmation email config' }, { status: 500 });
  }
}
