import { NextResponse, type NextRequest } from 'next/server';
import type { SsoIdTokenClaims } from './sso';
import { verifyIdToken } from './sso';
import { isSuperAdminEmail } from './sso-access';

// Shared core so Route Handlers (NextRequest.cookies, sync) and Server
// Components (next/headers cookies(), async) verify identically instead of
// each reimplementing the try/catch — used by app/api/auth/session,
// app/api/admin/users/*, and every brand page's requireBrandAccess() (lib/
// require-brand-access.ts).
export async function resolveSessionFromIdToken(idToken: string | undefined): Promise<SsoIdTokenClaims | null> {
  if (!idToken) return null;
  try {
    return await verifyIdToken(idToken);
  } catch {
    return null;
  }
}

// Session-based auth for the human admin UI (app/api/admin/users/*) —
// deliberately separate from lib/api-auth.ts's requireApiKey, which is the
// machine-to-machine scheme for the external research agent's writes and
// has no concept of "who is this person." Returns the verified claims on
// success, or the NextResponse to return immediately on failure.
export async function requireSuperAdminSession(request: NextRequest): Promise<SsoIdTokenClaims | NextResponse> {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isSuperAdminEmail(claims.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return claims;
}
