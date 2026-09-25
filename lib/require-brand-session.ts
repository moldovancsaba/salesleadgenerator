import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from './mongodb';
import { resolveSessionFromIdToken } from './session';
import { getUserAccess, hasAccessToBrand } from './sso-access';
import type { SsoIdTokenClaims } from './sso';
import type { Brand } from '@/app/lib/brand';

// Route-Handler equivalent of lib/require-brand-access.ts's page-level
// requireBrandAccess() (that one calls redirect(), Server-Component-only),
// but — unlike lib/require-brand-access-api.ts's requireBrandAccessApi() —
// session-only, with no x-api-key fallback, and returns the verified
// claims rather than just null/NextResponse. Used by issue #217's
// integration-connection routes, which need to know WHO performed a
// connect (IntegrationConnection.connectedBy) and are deliberately never
// reachable by any API key, scoped or legacy — a credential-management
// surface must never be reachable by a credential it itself manages, the
// same rule issue #210 §17 states for its own key-management API.
export async function requireBrandAccessSession(request: NextRequest, brand: Brand): Promise<SsoIdTokenClaims | NextResponse> {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims || !claims.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Access control not configured' }, { status: 503 });
  }

  const client = await getClientPromise();
  const db = client.db();
  const record = await getUserAccess(db, claims.sub);

  if (!hasAccessToBrand(claims.email, record?.orgAccess, brand)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return claims;
}
