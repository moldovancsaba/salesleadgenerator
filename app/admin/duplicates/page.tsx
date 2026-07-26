import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail } from '@/lib/sso-access';
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
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied');
  }

  return <AdminDuplicatesClient />;
}
