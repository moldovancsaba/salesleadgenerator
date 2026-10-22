import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WhatsNewClient } from './whats-new-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';
import { getReleaseNotes } from '@/lib/release-notes';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string }>;
}): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} — What's New & Release Notes` };
}

export default async function WhatsNewPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);
  const notes = getReleaseNotes();

  return (
    <WhatsNewClient
      initialNotes={notes}
      brand={brand}
      label={config?.label ?? brand}
    />
  );
}
