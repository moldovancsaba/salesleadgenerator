import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import clientPromise, { isMongoConfigured } from './mongodb';
import { resolveSessionFromIdToken } from './session';
import { getUserAccess, hasAccessToBrand } from './sso-access';
import type { Brand } from '@/app/lib/brand';

// Issue #103: the first real access-control gate on any page in this app.
// Called at the top of every brand-specific Server Component page (/sales/
// [brand], /salessettings/[client], /forecast/[brand], /battlecards/
// [brand], /outreach/templates/[brand]) before any data fetch. Not logged
// in -> straight to the real SSO login redirect (not a local /login page,
// since this app has no login form of its own). Logged in but not
// authorized for this specific brand -> /access-denied, never a silent
// partial render of another org's data.
export async function requireBrandAccess(brand: Brand): Promise<void> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims || !claims.email) {
    redirect('/api/auth/login');
  }

  if (!isMongoConfigured()) {
    // Same documented trade-off as every other Mongo-touching route in this
    // app (lib/mongodb.ts's isMongoConfigured() guard) — no database means
    // no org-access records exist yet, so nothing can be authorized.
    redirect('/access-denied');
  }

  const client = await clientPromise;
  const db = client.db();
  const record = await getUserAccess(db, claims.sub);

  if (!hasAccessToBrand(claims.email as string, record?.orgAccess, brand)) {
    redirect('/access-denied');
  }
}
