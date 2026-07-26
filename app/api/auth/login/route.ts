import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateState, isSsoConfigured } from '@/lib/sso';

// Short-lived, HTTP-only, first-party cookies carrying the PKCE verifier and
// CSRF state across the redirect to the hosted SSO login UI and back. 10
// minutes comfortably covers a real login (their hosted UI's own auth
// methods — password, magic link, PIN, social), never persisted longer.
const OAUTH_COOKIE_MAX_AGE = 60 * 10;

export async function GET(request: NextRequest) {
  if (!isSsoConfigured()) {
    return NextResponse.json(
      { error: 'SSO not configured', details: 'SSO_CLIENT_ID/SSO_CLIENT_SECRET/SSO_REDIRECT_URI are unset' },
      { status: 503 }
    );
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authorizeUrl = buildAuthorizeUrl({ state, codeChallenge });

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
  response.cookies.set('sso_oauth_state', state, cookieOpts);
  response.cookies.set('sso_code_verifier', codeVerifier, cookieOpts);
  return response;
}
