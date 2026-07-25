import type { Metadata } from 'next';
import { ForecastClient } from './forecast-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  return { title: `${BRAND_CONFIG[brand].label} Forecast` };
}

export default async function ForecastPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);

  return <ForecastClient brand={brand} />;
}
