import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail } from '@/lib/sso-access';
import { AdminClientsClient } from './admin-clients-client';

export const metadata = { title: 'Admin — Clients' };

// Issue #196 — the payoff of issue #195's Mongo-backed brand registry: a
// super admin can create a new brand/client here with no code deploy.
// Same global (not per-brand) super-admin gate as /admin/users.
export default async function AdminClientsPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims) {
    redirect('/api/auth/login');
  }
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied');
  }

  return <AdminClientsClient />;
}
