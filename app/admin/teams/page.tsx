import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSessionFromIdToken } from '@/lib/session';
import { isSuperAdminEmail } from '@/lib/sso-access';
import { AdminTeamsClient } from './admin-teams-client';

export const metadata = { title: 'Admin — Teams' };

// Team visibility (issue: CRM Team visibility) — gated identically to
// /admin/users (app/admin/users/page.tsx): super-admin only, global
// (SSO_SUPER_ADMIN_EMAILS), same reasoning — team membership/manager
// assignment is a per-brand-admin-adjacent concern this repo deliberately
// keeps super-admin-only in this phase (issue's own Non-Goals §6).
export default async function AdminTeamsPage() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);

  if (!claims) {
    redirect('/api/auth/login');
  }
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied');
  }

  return <AdminTeamsClient />;
}
