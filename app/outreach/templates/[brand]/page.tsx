import type { Metadata } from 'next';
import { OutreachTemplatesClient } from './templates-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  return { title: `${BRAND_CONFIG[brand].label} Outreach Templates` };
}

export default async function OutreachTemplatesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);

  return <OutreachTemplatesClient brand={brand} />;
}
