import { redirect } from 'next/navigation';
import { resolveUserPrimaryBrand } from '@/lib/resolve-user-brand';

export const dynamic = 'force-dynamic';

export default async function SalessettingsRootPage() {
  const brand = await resolveUserPrimaryBrand();
  redirect(`/salessettings/${brand}`);
}
