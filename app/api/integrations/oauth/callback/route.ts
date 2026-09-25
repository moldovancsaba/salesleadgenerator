import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { isIntegrationEncryptionConfigured } from '../../../../../lib/integration-crypto';
import { isKnownProvider, isOAuthProvider, oauthConfigFor, type IntegrationProvider } from '../../../../../lib/integration-connections';
import { isGoogleOAuthConfigured, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, upsertOAuthConnection } from '../../../../lib/integration-store';
import { fetchWithRetry } from '../../../../../lib/integration-http';

const OAUTH_STATE_COOKIE = 'integ_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'integ_oauth_verifier';

type OAuthStateCookie = { state: string; provider: string; brand: string; tenantId: string; ssoUserId: string };

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
// provider is looked up from the validated state cookie, not a per-provider
// route, since the token-exchange shape is identical across the whole
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
  if (!stateCookie || !stateCookie.brand) {
    const response = NextResponse.json({ error: 'Invalid or expired connection attempt — please try connecting again' }, { status: 400 });
    clearOauthCookies(response);
    return response;
  }

  if (errorParam) {
    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: errorParam }));
    clearOauthCookies(response);
    return response;
  }

  if (!code || !returnedState || returnedState !== stateCookie.state || !verifier) {
    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: 'invalid_state' }));
    clearOauthCookies(response);
    return response;
  }

  if (!isKnownProvider(stateCookie.provider) || !isOAuthProvider(stateCookie.provider)) {
    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: 'unknown_provider' }));
    clearOauthCookies(response);
    return response;
  }
  const provider = stateCookie.provider as IntegrationProvider;
  const cfg = oauthConfigFor(provider);

  if (!cfg || !isGoogleOAuthConfigured() || !isIntegrationEncryptionConfigured() || !isMongoConfigured()) {
    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: 'not_configured' }));
    clearOauthCookies(response);
    return response;
  }

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
      const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: 'token_exchange_failed' }));
      clearOauthCookies(response);
      return response;
    }

    const tokens = await tokenRes.json();
    const client = await clientPromise;
    const db = client.db();
    await upsertOAuthConnection(db, {
      brand: stateCookie.brand,
      tenantId: stateCookie.tenantId || 'default',
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scopes: cfg.scopes,
      connectedBy: stateCookie.ssoUserId,
    });

    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connected: provider }));
    clearOauthCookies(response);
    return response;
  } catch (error) {
    console.error('[api/integrations/oauth/callback] error:', error);
    const response = NextResponse.redirect(settingsUrl(request, stateCookie.brand, { connect_error: 'unexpected_error' }));
    clearOauthCookies(response);
    return response;
  }
}

export const dynamic = 'force-dynamic';
