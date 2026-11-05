import { cookies } from 'next/headers';
import { resolveSessionFromIdToken } from './session';
import { isMongoConfigured, getClientPromise } from './mongodb';
import { getUserAccess, getAccessibleBrands, isSuperAdminEmail } from './sso-access';
import { getAllBrandConfigs } from '@/app/lib/brand';

/**
 * Resolves the authenticated user's primary/active brand from their session,
 * falling back to the first accessible brand or first configured brand.
 */
export async function resolveUserPrimaryBrand(): Promise<string> {
  const brandConfigs = await getAllBrandConfigs();
  const allBrands = Object.keys(brandConfigs);
  const fallback = allBrands[0] || 'cogmap';

  try {
    const cookieStore = await cookies();
    const idToken = cookieStore.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);

    if (!claims || !claims.email) {
      return fallback;
    }

    if (isSuperAdminEmail(claims.email)) {
      return allBrands[0] || fallback;
    }

    if (isMongoConfigured()) {
      const client = await getClientPromise();
      const record = await getUserAccess(client.db(), claims.sub);
      const accessible = getAccessibleBrands(claims.email, record?.orgAccess, allBrands);
      if (accessible.length > 0) {
        return accessible[0];
      }
    }
  } catch {
    // If database or session resolution encounters an issue, return fallback
  }

  return fallback;
}
