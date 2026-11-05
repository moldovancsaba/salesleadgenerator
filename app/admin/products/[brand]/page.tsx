import { notFound, redirect } from 'next/navigation';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

// Issue #316: Unified into Sales Settings tab (?tab=products).
// This page redirects seamlessly to /salessettings/[brand]?tab=products.
export default async function AdminProductsPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);

  redirect(`/salessettings/${brand}?tab=products`);
}
