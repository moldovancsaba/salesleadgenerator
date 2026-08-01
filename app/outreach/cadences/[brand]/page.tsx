import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CadencesClient } from './cadences-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  return { title: `${BRAND_CONFIG[brand].label} Sales Cadences` };
}

export default async function CadencesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);

  return <CadencesClient brand={brand} />;
}
