import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { LandingCampaignClient } from './campaign-client';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string; campaign: string }>;
}): Promise<Metadata> {
  const { brand: brandParam, campaign: campaignParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);

  if (brand === 'vegas' || campaignParam.includes('darts') || campaignParam.includes('grand-slam')) {
    return {
      title: 'Win Tickets to the Grand Slam of Darts | Mr Vegas Giveaway',
      description: 'Enter the official Mr Vegas Grand Slam of Darts ticket giveaway. Top players battle it out at WV Active Aldersley for the Eric Bristow Trophy.',
    };
  }

  return {
    title: `${config?.label ?? brand} — Lead Collector & Registration`,
    description: `Official registration and inquiry portal for ${config?.label ?? brand}.`,
  };
}

export default async function LandingCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ brand: string; campaign: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { brand: brandParam, campaign: campaignParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  const config = await getBrandConfig(brand);
  const search = await searchParams;

  const utmSource = typeof search.utm_source === 'string' ? search.utm_source : '';
  const utmMedium = typeof search.utm_medium === 'string' ? search.utm_medium : '';
  const utmCampaign = typeof search.utm_campaign === 'string' ? search.utm_campaign : '';

  return (
    <LandingCampaignClient
      brand={brand}
      brandLabel={config?.label ?? brand}
      campaignSlug={campaignParam}
      utm={{ source: utmSource, medium: utmMedium, campaign: utmCampaign }}
    />
  );
}
