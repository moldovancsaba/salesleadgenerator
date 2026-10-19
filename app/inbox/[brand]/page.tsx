import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InboxClient } from './inbox-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Communication Center` };
}

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand: string }>;
  searchParams?: Promise<{ stream?: string; search?: string; lead?: string; thread?: string }>;
}) {
  const { brand: brandParam } = await params;
  const sp = searchParams ? await searchParams : {};
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return (
    <InboxClient
      brand={brand}
      label={config?.label ?? brand}
      initialStream={sp.stream}
      initialSearch={sp.search || sp.lead}
      initialThreadId={sp.thread}
    />
  );
}
