import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';
import { toPublicScannerConfig } from '@/lib/landing-page-schema';
import { HostessQrReaderClient } from './hostess-qr-reader-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string; campaign: string }>;
}): Promise<Metadata> {
  const { brand: brandParam, campaign: campaignParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);

  const page = await getLandingPageBySlug(brand, campaignParam);
  return {
    title: `Check-in | ${page?.title || campaignParam} | ${config?.label ?? brand}`,
    description: 'Check-in scanner for event staff.',
    robots: { index: false, follow: false },
  };
}

/** Reader for a page whose scanner is on; any other page is not found. Only the public part of the scanner settings reaches the browser. */
export default async function HostessQrReaderPage({
  params,
}: {
  params: Promise<{ brand: string; campaign: string }>;
}) {
  const { brand: brandParam, campaign: campaignParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();

  const page = await getLandingPageBySlug(brand, campaignParam);
  if (!page?.scanner?.enabled) notFound();

  return (
    <HostessQrReaderClient
      brand={brand}
      campaign={campaignParam}
      campaignTitle={page.title}
      scanner={toPublicScannerConfig(page.scanner)}
    />
  );
}
