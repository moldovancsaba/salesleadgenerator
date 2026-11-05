import { redirect } from 'next/navigation';
import { resolveUserPrimaryBrand } from '@/lib/resolve-user-brand';

export const dynamic = 'force-dynamic';

export default async function InboxRootPage() {
  const brand = await resolveUserPrimaryBrand();
  redirect(`/inbox/${brand}`);
}
