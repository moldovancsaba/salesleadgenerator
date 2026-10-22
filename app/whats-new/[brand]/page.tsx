import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { WhatsNewClient } from './whats-new-client';
import { resolveBrand, getBrandConfig, getAllBrandConfigs, type Brand } from '@/app/lib/brand';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getUserAccess, getAccessibleBrands, hasAccessToBrand } from '@/lib/sso-access';
import { getReleaseNotes } from '@/lib/release-notes';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string }>;
}): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return { title: 'Not Found' };
  const config = await getBrandConfig(brand);
  return { title: `${config?.label ?? brand} — What's New & Release Notes` };
}

export default async function WhatsNewPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) notFound();

  try {
    const cookieStore = await cookies();
    const idToken = cookieStore.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    if (claims?.email && isMongoConfigured()) {
      const client = await clientPromise;
      const db = client.db();
      const record = await getUserAccess(db, claims.sub);
      if (!hasAccessToBrand(claims.email as string, record?.orgAccess, brand)) {
        const configs = await getAllBrandConfigs();
        const allBrands = Object.keys(configs) as Brand[];
        const accessible = getAccessibleBrands(claims.email as string, record?.orgAccess, allBrands);
        if (accessible.length > 0 && accessible[0] !== brand) {
          redirect(`/whats-new/${accessible[0]}`);
        }
      }
    }
  } catch (err: any) {
    // Re-throw Next.js redirect errors
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
  }

  const config = await getBrandConfig(brand);
  const notes = getReleaseNotes();

  return (
    <WhatsNewClient
      initialNotes={notes}
      brand={brand}
      label={config?.label ?? brand}
    />
  );
}
