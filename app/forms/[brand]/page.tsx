import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InboundFormClient } from './form-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string }>;
}): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return {
    title: `Contact ${config?.label ?? brand} — Request a Demo & Inquiry`,
  };
}

export default async function InboundFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const { brand: brandParam } = await params;
  const { embed } = await searchParams;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  const config = await getBrandConfig(brand);

  return (
    <InboundFormClient
      brand={brand}
      label={config?.label ?? brand}
      embed={embed === '1' || embed === 'true'}
    />
  );
}
