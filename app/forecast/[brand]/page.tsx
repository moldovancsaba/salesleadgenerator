import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForecastClient } from './forecast-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Forecast` };
}

export default async function ForecastPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <ForecastClient brand={brand} label={config?.label ?? brand} />;
}
