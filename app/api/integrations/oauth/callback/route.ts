import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { isIntegrationEncryptionConfigured } from '../../../../../lib/integration-crypto';
import { isKnownProvider, isOAuthProvider, oauthConfigFor, type IntegrationProvider } from '../../../../../lib/integration-connections';
import { isGoogleOAuthConfigured, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, upsertOAuthConnection, consumePendingOAuthState } from '../../../../lib/integration-store';
import { fetchWithRetry } from '../../../../../lib/integration-http';
import { requireBrandAccessSession } from '../../../../../lib/require-brand-session';
import { resolveBrand } from '../../../../lib/brand';

const OAUTH_STATE_COOKIE = 'integ_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'integ_oauth_verifier';

// Only `state` and the brand used to choose a redirect target are read from
// the cookie; brand, tenant, provider and user for the stored connection
// come from the server-side record (issue #228).
type OAuthStateCookie = { state: string; brand: string };

function clearOauthCookies(response: NextResponse) {
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
}

function settingsUrl(request: NextRequest, brand: string, query: Record<string, string>): URL {
  const url = new URL(`/salessettings/${encodeURIComponent(brand)}/integrations`, request.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

// Single shared callback for every oauth2 provider (issue #217 §8) — the
// provider is looked up from the server-side state record (issue #228), not
// a per-provider route, since the token-exchange shape is identical across the whole
// Google family and only the requested scopes differ.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const stateCookieRaw = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

  let stateCookie: OAuthStateCookie | null = null;
  try {
    stateCookie = stateCookieRaw ? (JSON.parse(decodeURIComponent(stateCookieRaw)) as OAuthStateCookie) : null;
  } catch {
    stateCookie = null;
  }

  // No parseable state cookie at all — nowhere safe to redirect back to
  // (we don't know which brand's settings page to send the admin to), so
  // this is the one case that returns a bare JSON error instead.
  const redirectBrand = stateCookie?.brand ? await resolveBrand(stateCookie.brand) : null;
  if (!stateCookie || !redirectBrand) {
    const response = NextResponse.json({ error: 'Invalid or expired connection attempt — please try connecting again' }, { status: 400 });
    clearOauthCookies(response);
    return response;
  }
  const fail = (reason: string, brand: string = redirectBrand) => {
    const response = NextResponse.redirect(settingsUrl(request, brand, { connect_error: reason }));
    clearOauthCookies(response);
    return response;
  };

  if (errorParam) return fail(errorParam);

  if (!code || !returnedState || returnedState !== stateCookie.state || !verifier) {
    return fail('invalid_state');
  }

  if (!isGoogleOAuthConfigured() || !isIntegrationEncryptionConfigured() || !isMongoConfigured()) {
    return fail('not_configured');
  }

  // Issue #228: the cookie is plain JSON the browser can rewrite, so the
  // brand, tenant, provider and user come from the single-use record the
  // connect route stored, and the person completing the flow must still
  // hold a session with access to that brand — the same person who started
  // it. Consumed before the session check, so a failed attempt burns it.
  const client = await clientPromise;
  const db = client.db();
  const pending = await consumePendingOAuthState(db, returnedState);
  if (!pending) return fail('invalid_state');
  const brand = await resolveBrand(pending.brand);
  if (!brand) return fail('invalid_state');

  const claimsOrResponse = await requireBrandAccessSession(request, brand);
  if (claimsOrResponse instanceof NextResponse) {
    const reason = claimsOrResponse.status === 401 ? 'session_expired' : claimsOrResponse.status === 403 ? 'forbidden' : 'not_configured';
    return fail(reason, brand);
  }
  if (claimsOrResponse.sub !== pending.ssoUserId) return fail('forbidden', brand);

  if (!isKnownProvider(pending.provider) || !isOAuthProvider(pending.provider)) {
    return fail('unknown_provider', brand);
  }
  const provider = pending.provider as IntegrationProvider;
  const cfg = oauthConfigFor(provider);
  if (!cfg) return fail('not_configured', brand);

  try {
    // Real Google OAuth2 token endpoint contract: application/x-www-form-
    // urlencoded body, not JSON (unlike lib/sso.ts's DoneIsBetter-specific
    // JSON-body shape) — verified against Google's own published docs.
    const tokenRes = await fetchWithRetry(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        code_verifier: verifier,
      }),
    });

    if (!tokenRes.ok) {
      return fail('token_exchange_failed', brand);
    }

    const tokens = await tokenRes.json();
    await upsertOAuthConnection(db, {
      brand,
      tenantId: pending.tenantId || 'default',
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scopes: cfg.scopes,
      connectedBy: claimsOrResponse.sub,
    });

    const response = NextResponse.redirect(settingsUrl(request, brand, { connected: provider }));
    clearOauthCookies(response);
    return response;
  } catch (error) {
    console.error('[api/integrations/oauth/callback] error:', error);
    return fail('unexpected_error', brand);
  }
}

export const dynamic = 'force-dynamic';
