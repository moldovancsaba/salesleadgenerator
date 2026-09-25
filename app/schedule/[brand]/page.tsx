import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ScheduleClient } from './schedule-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';

// Issue #207 — the public, unauthenticated booking page. No requireBrandAccess
// call here (deliberately, unlike every other brand-scoped page in this
// app) — a prospect who receives this link has no SSO session at all, by
// design. resolveBrand() still 404s an unknown brand slug, the same
// not-found behavior any other brand page gets for a bad URL.
export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `Schedule a meeting — ${config?.label ?? brand}` };
}

export default async function SchedulePage({ params, searchParams }: {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { brand: brandParam } = await params;
  const { leadId } = await searchParams;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  const config = await getBrandConfig(brand);

  return <ScheduleClient brand={brand} label={config?.label ?? brand} leadId={leadId} />;
}
