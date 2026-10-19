import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { isIntegrationEncryptionConfigured } from '../../../../../lib/integration-crypto';
import { isKnownProvider, isOAuthProvider, oauthConfigFor, type IntegrationProvider } from '../../../../../lib/integration-connections';
import { isGoogleOAuthConfigured, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, upsertOAuthConnection, consumePendingOAuthState } from '../../../../lib/integration-store';
import { fetchWithRetry } from '../../../../../lib/integration-http';
import { requireBrandAccessSession } from '../../../../../lib/require-brand-session';
import { resolveBrand } from '../../../../lib/brand';
import { syncUserGmailSignature } from '../../../../../lib/gmail-signature';
import { pollUserGmail } from '../../../../lib/gmail-sync-store';

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
  const fail = (reason: string, brand: string = redirectBrand, fallbackUrl?: string) => {
    let target: URL;
    if (fallbackUrl) {
      target = new URL(fallbackUrl, request.url);
      target.searchParams.set('connect_error', reason);
      target.searchParams.set('error', reason);
    } else {
      target = settingsUrl(request, brand, { connect_error: reason, error: reason });
    }
    const response = NextResponse.redirect(target);
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
  if (!brand) return fail('invalid_state', redirectBrand, pending.returnUrl);

  const claimsOrResponse = await requireBrandAccessSession(request, brand);
  if (claimsOrResponse instanceof NextResponse) {
    const reason = claimsOrResponse.status === 401 ? 'session_expired' : claimsOrResponse.status === 403 ? 'forbidden' : 'not_configured';
    return fail(reason, brand, pending.returnUrl);
  }
  if (claimsOrResponse.sub !== pending.ssoUserId) return fail('forbidden', brand, pending.returnUrl);

  if (!isKnownProvider(pending.provider) || !isOAuthProvider(pending.provider)) {
    return fail('unknown_provider', brand, pending.returnUrl);
  }
  const provider = pending.provider as IntegrationProvider;
  const cfg = oauthConfigFor(provider);
  if (!cfg) return fail('not_configured', brand, pending.returnUrl);

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
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || GOOGLE_OAUTH_REDIRECT_URI,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || GOOGLE_OAUTH_CLIENT_SECRET,
        code_verifier: verifier,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({}));
      console.error('[api/integrations/oauth/callback] token exchange rejected:', tokenRes.status, errBody);
      const detail = (errBody.error_description || errBody.error || `status_${tokenRes.status}`)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 60);
      return fail(`token_exchange_${detail}`, brand, pending.returnUrl);
    }

    const tokens = await tokenRes.json();

    let providerAccountLabel: string | undefined;
    let userEmail: string | undefined;
    if (provider === 'gmail') {
      try {
        const profileRes = await fetchWithRetry('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          if (profile.emailAddress) {
            providerAccountLabel = profile.emailAddress;
            userEmail = profile.emailAddress;
          }
        }
      } catch (err) {
        console.error('[api/integrations/oauth/callback] profile fetch failed', err);
      }
    }

    if (!userEmail) {
      try {
        const userinfoRes = await fetchWithRetry('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          if (userinfo.email) {
            userEmail = userinfo.email;
            providerAccountLabel = userinfo.email;
          }
        }
      } catch (err) {
        // Non-fatal
      }
    }

    const isUserScope = pending.scopeType === 'user';
    const userEmailResolved = userEmail || claimsOrResponse.email;
    const providerAccountLabelResolved = providerAccountLabel || userEmailResolved;

    await upsertOAuthConnection(db, {
      brand,
      tenantId: pending.tenantId || 'default',
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scopes: cfg.scopes,
      connectedBy: claimsOrResponse.sub,
      ...(isUserScope ? { userId: claimsOrResponse.sub } : {}),
      ...(userEmailResolved ? { userEmail: userEmailResolved } : {}),
      ...(providerAccountLabelResolved ? { providerAccountLabel: providerAccountLabelResolved } : {}),
    });

    if (provider === 'gmail' && isUserScope) {
      try {
        await syncUserGmailSignature(db, claimsOrResponse.sub, userEmailResolved);
        await pollUserGmail(db, claimsOrResponse.sub, brand).catch(() => {});
      } catch (sigErr) {
        console.error('[api/integrations/oauth/callback] auto signature/gmail sync failed:', sigErr);
      }
    }

    let redirectUrl: URL;
    if (pending.returnUrl) {
      redirectUrl = new URL(pending.returnUrl, request.url);
      redirectUrl.searchParams.set('connected', provider);
    } else {
      redirectUrl = settingsUrl(request, brand, { connected: provider });
    }

    const response = NextResponse.redirect(redirectUrl);
    clearOauthCookies(response);
    return response;
  } catch (error: any) {
    console.error('[api/integrations/oauth/callback] error:', error);
    const detail = error?.code === 11000
      ? 'duplicate_connection'
      : (error?.message ? `error_${encodeURIComponent(error.message.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60))}` : 'unexpected_error');
    return fail(detail, brand, pending?.returnUrl);
  }
}

export const dynamic = 'force-dynamic';
