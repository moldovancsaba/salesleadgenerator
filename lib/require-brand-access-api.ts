import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from './mongodb';
import { resolveSessionFromIdToken } from './session';
import { getUserAccess, hasAccessToBrand } from './sso-access';
import type { Brand } from '@/app/lib/brand';

// Route-handler equivalent of lib/require-brand-access.ts's page-level gate
// (issue #103) — that one calls redirect(), which only works inside Server
// Components, not Route Handlers. This returns a NextResponse to send back
// immediately instead. Issue #104: the core lead data API (GET/PATCH
// /api/leads, GET /api/leads/columns, PATCH /api/leads/bulk, GET/DELETE
// /api/leads/[id]) never had this applied, so per-org access control's
// promise was never enforced where the data actually lives.
function hasValidApiKey(request: NextRequest): boolean {
  const configuredKey = process.env.SLG_API_KEY || '';
  if (!configuredKey) return false;
  return request.headers.get('x-api-key') === configuredKey;
}

export async function requireBrandAccessApi(request: NextRequest, brand: Brand): Promise<NextResponse | null> {
  // Machine callers (research agent, documented external integrations) —
  // same secret as every other API-key-gated write route. Deliberately NOT
  // reusing lib/api-auth.ts's requireApiKey() here: that helper fails open
  // (returns null / "authorized") when SLG_API_KEY isn't configured, which
  // is fine for a route that has no other guard, but would silently defeat
  // the session check below on this combined-auth path.
  if (hasValidApiKey(request)) {
    return null;
  }

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

  return null;
}
