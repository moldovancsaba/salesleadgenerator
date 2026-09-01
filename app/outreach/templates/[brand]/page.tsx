import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OutreachTemplatesClient } from './templates-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Outreach Templates` };
}

export default async function OutreachTemplatesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <OutreachTemplatesClient brand={brand} label={config?.label ?? brand} />;
}
