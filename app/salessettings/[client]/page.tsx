import type { Metadata } from 'next';
import { SalesSettingsClient } from './sales-settings-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';

export async function generateMetadata({ params }: { params: Promise<{ client: string }> }): Promise<Metadata> {
  const { client: clientParam } = await params;
  const brand = resolveBrand(clientParam);
  return { title: `${BRAND_CONFIG[brand].label} Settings` };
}

export default async function SalesSettingsPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: clientParam } = await params;
  const brand = resolveBrand(clientParam);

  return <SalesSettingsClient brand={brand} />;
}
