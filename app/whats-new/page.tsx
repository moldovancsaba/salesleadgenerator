import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAllBrandConfigs, type Brand } from '@/app/lib/brand';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getUserAccess, getAccessibleBrands } from '@/lib/sso-access';

export const dynamic = 'force-dynamic';

export default async function WhatsNewRedirectPage() {
  const configs = await getAllBrandConfigs();
  const allBrands = Object.keys(configs) as Brand[];
  let targetBrand: Brand = allBrands[0] || 'cogmap';

  try {
    const cookieStore = await cookies();
    const idToken = cookieStore.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    if (!claims?.email) {
      redirect('/api/auth/login');
    }
    if (isMongoConfigured()) {
      const client = await clientPromise;
      const db = client.db();
      const record = await getUserAccess(db, claims.sub);
      const accessible = getAccessibleBrands(claims.email as string, record?.orgAccess, allBrands);
      if (accessible.length > 0) {
        targetBrand = accessible[0];
      } else {
        redirect('/access-denied');
      }
    }
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    redirect('/api/auth/login');
  }

  redirect(`/whats-new/${targetBrand}`);
}
