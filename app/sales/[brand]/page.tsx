import type { Metadata } from 'next';
import { SalesPageClient } from './sales-page-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  return { title: BRAND_CONFIG[brand].label };
}

export default async function SalesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = brandParam || 'cogmap';

  return <SalesPageClient brand={brand} />;
}
