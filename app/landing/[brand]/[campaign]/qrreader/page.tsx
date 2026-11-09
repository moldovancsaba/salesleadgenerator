import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug } from '@/lib/landing-page-store';
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
    title: `Hostess QR Reader | ${page?.title || campaignParam} | ${config?.label ?? brand}`,
    description: 'Dedicated hostess attendee badge QR scanner and CRM check-in portal.',
  };
}

export default async function HostessQrReaderPage({
  params,
}: {
  params: Promise<{ brand: string; campaign: string }>;
}) {
  const { brand: brandParam, campaign: campaignParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();

  const page = await getLandingPageBySlug(brand, campaignParam);

  return (
    <HostessQrReaderClient
      brand={brand}
      campaign={campaignParam}
      campaignTitle={page?.title || 'Mr Vegas Grand Slam of Darts'}
    />
  );
}
