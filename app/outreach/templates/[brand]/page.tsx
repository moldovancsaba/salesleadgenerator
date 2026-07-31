import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OutreachTemplatesClient } from './templates-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  return { title: `${BRAND_CONFIG[brand].label} Outreach Templates` };
}

export default async function OutreachTemplatesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);

  return <OutreachTemplatesClient brand={brand} />;
}
