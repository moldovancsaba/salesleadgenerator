import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SalesSettingsClient } from './sales-settings-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ client: string }> }): Promise<Metadata> {
  const { client: clientParam } = await params;
  const brand = await resolveBrand(clientParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Settings` };
}

export default async function SalesSettingsPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: clientParam } = await params;
  const brand = await resolveBrand(clientParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <SalesSettingsClient brand={brand} label={config?.label ?? brand} currency={config?.currency} salesVocabulary={config?.salesVocabulary} />;
}
