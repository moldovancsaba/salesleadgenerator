import { redirect } from 'next/navigation';
import { resolveBrand } from '@/app/lib/brand';
import { notFound } from 'next/navigation';

export default async function BrandLandingRootPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();

  if (brand === 'vegas') {
    redirect('/landing/vegas/grand-slam-of-darts');
  }

  redirect(`/forms/${brand}`);
}
