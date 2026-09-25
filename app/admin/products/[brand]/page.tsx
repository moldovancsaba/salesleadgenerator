import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdminProductsClient } from './admin-products-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

// Issue #215 §17 — same brand-scoped, not super-admin-only, gate as
// /salessettings/[client]: this is browser-writable commercial
// configuration a logged-in-context rep edits directly, not a super-admin
// surface like /admin/clients.
export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Product Catalog` };
}

export default async function AdminProductsPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <AdminProductsClient brand={brand} label={config?.label ?? brand} defaultCurrency={config?.currency ?? 'USD'} />;
}
