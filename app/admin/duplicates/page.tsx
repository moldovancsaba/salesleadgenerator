import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail, getUserAccess } from '@/lib/sso-access';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { AdminDuplicatesClient } from './admin-duplicates-client';

export const metadata = { title: 'Admin — Duplicate Review' };

// Same super-admin gate as app/admin/users/page.tsx.
export default async function AdminDuplicatesPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims) {
    redirect('/api/auth/login');
  }
  // Super admin, or a user who is admin of at least one workspace (client
  // delivery #20); the client and every API call then scope to those brands.
  if (!isSuperAdminEmail(claims.email)) {
    let hasAdminRole = false;
    if (isMongoConfigured()) {
      const db = (await clientPromise).db();
      const record = await getUserAccess(db, claims.sub);
      hasAdminRole = Object.values(record?.orgAccess || {}).some((role) => role === 'admin');
    }
    if (!hasAdminRole) redirect('/access-denied');
  }

  return <AdminDuplicatesClient />;
}
