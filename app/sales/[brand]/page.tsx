import { SalesPageClient } from './sales-page-client';

export default async function SalesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = brandParam || 'cogmap';

  return <SalesPageClient brand={brand} />;
}
