import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail } from '@/lib/sso-access';
import { AdminApiKeysClient } from './admin-api-keys-client';

export const metadata = { title: 'Admin — API Keys' };

// Scoped API keys (issue #210, Phase 1) — gated identically to
// /admin/teams//admin/clients: super-admin only, global.
export default async function AdminApiKeysPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims) {
    redirect('/api/auth/login');
  }
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied');
  }

  return <AdminApiKeysClient />;
}
