import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail } from '@/lib/sso-access';
import { AdminUsersClient } from './admin-users-client';

export const metadata = { title: 'Admin — Users' };

// Issue #103: the only page in this app gated on a specific person's
// identity rather than per-brand access — super-admin status is global
// (SSO_SUPER_ADMIN_EMAILS), not tied to any one org.
export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims) {
    redirect('/api/auth/login');
  }
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied');
  }

  return <AdminUsersClient />;
}
