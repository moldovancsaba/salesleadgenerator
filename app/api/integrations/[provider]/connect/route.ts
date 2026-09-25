import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { requireBrandAccessSession } from '../../../../../lib/require-brand-session';
import { resolveBrand } from '../../../../lib/brand';
import { getTenantId } from '../../../../../lib/tenant';
import { generateState, generateCodeVerifier, generateCodeChallenge } from '../../../../../lib/sso';
import { isIntegrationEncryptionConfigured } from '../../../../../lib/integration-crypto';
import {
  isKnownProvider, isOAuthProvider, apiKeyConfigFor, buildGoogleAuthorizeUrl,
  type IntegrationProvider,
} from '../../../../../lib/integration-connections';
import { isGoogleOAuthConfigured, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI, upsertApiKeyConnection } from '../../../../lib/integration-store';
import { fetchWithRetry } from '../../../../../lib/integration-http';

const OAUTH_STATE_COOKIE = 'integ_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'integ_oauth_verifier';
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes — enough for a real consent-screen round trip

// GET — initiates the OAuth redirect for the Google provider family
// (google_calendar/gmail/google_contacts). Issue #217 §8: state and the
// PKCE verifier are stored in NEW, separate httpOnly cookies — never
// sso_oauth_state/sso_code_verifier — so a rep mid-SSO-login and
// mid-integration-connect at the same time never has one flow's cookie
// clobber the other's.
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  if (!isKnownProvider(providerParam) || !isOAuthProvider(providerParam)) {
    return NextResponse.json({ error: 'Unknown or non-OAuth provider' }, { status: 400 });
  }
  const provider = providerParam as IntegrationProvider;

  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const claimsOrResponse = await requireBrandAccessSession(request, brand);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json({ error: 'Google integration is not configured' }, { status: 503 });
  }
  if (!isIntegrationEncryptionConfigured()) {
    return NextResponse.json({ error: 'Integration credential storage is not configured' }, { status: 503 });
  }

  const tenantId = getTenantId(request);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(verifier);

  const authorizeUrl = buildGoogleAuthorizeUrl({
    provider: provider as 'google_calendar' | 'gmail' | 'google_contacts',
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
    state,
    codeChallenge,
  });

  const response = NextResponse.redirect(authorizeUrl);
  const secureCookie = process.env.NODE_ENV === 'production';
  // encodeURIComponent, not a raw JSON string: RFC 6265 forbids an
  // unescaped double-quote/comma in a cookie-value, both of which any JSON
  // object serialization contains — relying on a framework to silently
  // re-encode this would be a real, easy-to-miss correctness bug, not just
  // a test-writing inconvenience.
  response.cookies.set(
    OAUTH_STATE_COOKIE,
    encodeURIComponent(JSON.stringify({ state, provider, brand, tenantId, ssoUserId: claimsOrResponse.sub })),
    { httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: OAUTH_COOKIE_MAX_AGE }
  );
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, {
    httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}

// POST — verify-before-store connect for the api_key provider family
// (Calendly). An invalid/typo'd/expired token is never persisted (issue
// #217 §11/§17/§18) — the verify call runs before any database write.
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  if (!isKnownProvider(providerParam) || isOAuthProvider(providerParam)) {
    return NextResponse.json({ error: 'Unknown or non-API-key provider' }, { status: 400 });
  }
  const provider = providerParam as IntegrationProvider;

  const body = await request.json().catch(() => ({}));
  const brand = await resolveBrand(body.brand);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const claimsOrResponse = await requireBrandAccessSession(request, brand);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });

  if (!isIntegrationEncryptionConfigured()) {
    return NextResponse.json({ error: 'Integration credential storage is not configured' }, { status: 503 });
  }
  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const cfg = apiKeyConfigFor(provider);
  if (!cfg) return NextResponse.json({ error: 'Unknown or non-API-key provider' }, { status: 400 });

  let verifyResult: Response;
  try {
    verifyResult = await fetchWithRetry(cfg.verifyUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    return NextResponse.json({ error: 'Could not reach the provider to verify this key' }, { status: 422 });
  }
  if (!verifyResult.ok) {
    return NextResponse.json({ error: 'Could not verify this key against the provider' }, { status: 422 });
  }
  const verifyBody = await verifyResult.json().catch(() => ({}));
  const providerAccountLabel: string | undefined = verifyBody?.resource?.name;

  const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim() ? body.tenantId.trim() : 'default';
  const client = await clientPromise;
  const db = client.db();
  await upsertApiKeyConnection(db, { brand, tenantId, provider, apiKey, providerAccountLabel, connectedBy: claimsOrResponse.sub });

  return NextResponse.json({ connected: true });
}

export const dynamic = 'force-dynamic';
