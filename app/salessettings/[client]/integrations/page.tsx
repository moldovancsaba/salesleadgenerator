import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IntegrationsClient } from './integrations-client';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccess } from '@/lib/require-brand-access';

// Third-party integration connection hub (issue #217). Ships as a new
// sub-page under the existing per-brand Sales Settings surface
// (/salessettings/[client]/integrations), gated identically
// (requireBrandAccess — any admin with this brand's orgAccess, not only
// the super admin), rather than under /admin — a connection is inherently
// brand-scoped, not a cross-brand super-admin concern. This also avoids a
// real route-naming collision with issue #210's own, unrelated
// /admin/api-keys page, which independently considered /admin/integrations
// for its own inbound-credential surface.
export async function generateMetadata({ params }: { params: Promise<{ client: string }> }): Promise<Metadata> {
  const { client: clientParam } = await params;
  const brand = await resolveBrand(clientParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} Integrations` };
}

export default async function IntegrationsPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: clientParam } = await params;
  const brand = await resolveBrand(clientParam);
  if (!brand) notFound();
  await requireBrandAccess(brand);
  const config = await getBrandConfig(brand);

  return <IntegrationsClient brand={brand} label={config?.label ?? brand} />;
}
