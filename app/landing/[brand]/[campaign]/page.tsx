import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { getLandingPageBySlug, incrementLandingPageView } from '@/lib/landing-page-store';
import { toPublicLandingPage } from '@/lib/landing-page-schema';
import { DynamicLandingClient } from './dynamic-landing-client';

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
  if (page) {
    return {
      title: `${page.title} | ${config?.label ?? brand}`,
      description: page.description || page.heroSubheadline || `Official registration and inquiry portal for ${config?.label ?? brand}.`,
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

  const page = await getLandingPageBySlug(brand, campaignParam);
  if (!page) {
    notFound();
  }

  // Increment view metric asynchronously
  incrementLandingPageView(brand, campaignParam).catch(() => {});

  const utmSource = typeof search.utm_source === 'string' ? search.utm_source : '';
  const utmMedium = typeof search.utm_medium === 'string' ? search.utm_medium : '';
  const utmCampaign = typeof search.utm_campaign === 'string' ? search.utm_campaign : '';

  return (
    <DynamicLandingClient
      page={toPublicLandingPage(page)}
      brand={brand}
      brandLabel={config?.label ?? brand}
      campaignSlug={campaignParam}
      utm={{ source: utmSource, medium: utmMedium, campaign: utmCampaign }}
    />
  );
}
