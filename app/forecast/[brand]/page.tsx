import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForecastClient } from './forecast-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  return { title: `${BRAND_CONFIG[brand].label} Forecast` };
}

export default async function ForecastPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);

  return <ForecastClient brand={brand} />;
}
