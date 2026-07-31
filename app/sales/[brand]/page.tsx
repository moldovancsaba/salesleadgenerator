import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SalesPageClient } from './sales-page-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  return { title: BRAND_CONFIG[brand].label };
}

export default async function SalesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  // Was `brandParam || 'cogmap'` (not resolveBrand()) — an invalid brand
  // segment passed straight through unnormalized. Fixed alongside adding
  // the access check (issue #103), since that check needs a real Brand,
  // not an arbitrary string.
  const brand = resolveBrand(brandParam);
  // Issue #147 — resolveBrand() now returns null for a genuinely
  // unrecognized brand (was: silently resolved to 'cogmap'); a real 404,
  // not a silent wrong-brand render.
  if (!brand) notFound();
  await requireBrandAccess(brand);

  return <SalesPageClient brand={brand} />;
}
