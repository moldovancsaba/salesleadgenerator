import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from './mongodb';
import { resolveSessionFromIdToken } from './session';
import { getUserAccess, hasAccessToBrand } from './sso-access';
import type { Brand } from '@/app/lib/brand';
import { verifyScopedApiKey } from '@/app/lib/api-key-store';
import { recordLegacyKeyUse } from './legacy-key-usage';

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
    recordLegacyKeyUse(request);
    return null;
  }

  // Scoped API keys (issue #210) — a per-brand, per-scope, revocable
  // credential, additive alongside the legacy shared key above. A key
  // whose hash isn't found in api_keys at all falls through to the
  // session-cookie branch below, exactly as any other non-matching
  // x-api-key header already did before this issue; a key that IS found
  // but fails the brand or scope check fails closed immediately (never
  // silently falls through to session), matching this repo's existing
  // "an invalid credential fails closed" philosophy. Scoped keys live in
  // Mongo, so when Mongo isn't configured at all no scoped key could ever
  // be valid — that's treated as an unmatched key (falls through to the
  // session branch below) rather than a hard failure, preserving the
  // pre-existing behavior of a bogus x-api-key with no session cookie
  // (401, not 503) instead of forcing every request carrying any
  // x-api-key header through a Mongo-config check it doesn't need.
  const rawKey = request.headers.get('x-api-key');
  if (rawKey && isMongoConfigured()) {
    const client = await getClientPromise();
    const db = client.db();
    const scopedResult = await verifyScopedApiKey(db, rawKey, brand, request.method);
    if (scopedResult.authorized) return null;
    if (scopedResult.matched) {
      return NextResponse.json(
        { error: scopedResult.status === 403 ? 'Forbidden' : 'Unauthorized' },
        { status: scopedResult.status }
      );
    }
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

// Machine-only variant (issue #220): the legacy key or a scoped key for this
// brand with the scope the method needs — never a browser session. For
// routes whose only caller is an integration, e.g. PUT /api/leads/[id], the
// research agent's enrichment path, which had accepted only the legacy key,
// so the agent could not move to a per-brand, revocable key. Fails closed
// when neither key is configured or matches, unlike lib/api-auth.ts's
// requireApiKey, which fails open outside production.
export async function requireMachineKeyApi(request: Request, brand: Brand): Promise<NextResponse | null> {
  const configuredKey = process.env.SLG_API_KEY || '';
  const rawKey = request.headers.get('x-api-key');
  if (configuredKey && rawKey === configuredKey) {
    recordLegacyKeyUse(request);
    return null;
  }
  if (rawKey && isMongoConfigured()) {
    const client = await getClientPromise();
    const result = await verifyScopedApiKey(client.db(), rawKey, brand, request.method);
    if (result.authorized) return null;
    if (result.matched) {
      return NextResponse.json({ error: result.status === 403 ? 'Forbidden' : 'Unauthorized' }, { status: result.status });
    }
  }
  return NextResponse.json({ error: 'Unauthorized', details: 'Missing or invalid x-api-key' }, { status: 401 });
}
