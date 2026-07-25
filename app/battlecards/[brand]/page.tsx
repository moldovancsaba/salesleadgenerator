import type { Metadata } from 'next';
import { BattlecardsClient } from './battlecards-client';
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand';

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);
  return { title: `${BRAND_CONFIG[brand].label} Battlecards` };
}

export default async function BattlecardsPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = resolveBrand(brandParam);

  return <BattlecardsClient brand={brand} />;
}
