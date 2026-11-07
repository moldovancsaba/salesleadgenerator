import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';
import { LandingPagesClient } from './landing-pages-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string }>;
}): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Landing Pages` };
}

export default async function LandingPagesPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <LandingPagesClient brand={brand} brandLabel={config?.label ?? brand} />;
}
