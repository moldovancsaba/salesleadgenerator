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

// x-api-key OR any authenticated session, with no brand or admin check —
// for global (not brand-scoped) config that any signed-in user may read or
// write, distinct from requireSuperAdminSession (admin-only) above and
// lib/require-brand-access-api.ts's requireBrandAccessApi (brand-scoped).
// Issue #192: PUT /api/settings is called from app/forecast/[brand]/
// forecast-client.tsx by any brand-authorized user (saveWeights,
// handleCalibrationModeChange) — not an admin-only flow — so
// requireSuperAdminSession would wrongly 403 a legitimate in-app caller.
// Local hasValidApiKey rather than lib/api-auth.ts's requireApiKey: that
// helper fails open when SLG_API_KEY is unset, which would silently defeat
// the session check below on this combined-auth path (same reasoning as
// requireBrandAccessApi's own local copy of this check).
function hasValidApiKey(request: NextRequest): boolean {
  const configuredKey = process.env.SLG_API_KEY || '';
  if (!configuredKey) return false;
  return request.headers.get('x-api-key') === configuredKey;
}

export async function requireApiKeyOrSession(request: NextRequest): Promise<NextResponse | null> {
  if (hasValidApiKey(request)) {
    return null;
  }

  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims || !claims.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return null;
}
