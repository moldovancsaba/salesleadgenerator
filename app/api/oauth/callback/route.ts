import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, getPermission, verifyIdToken } from '@/lib/sso';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveLoginDestination, upsertUserSeen, type SsoUserAccessRecord } from '@/lib/sso-access';
import { getAllBrandConfigs } from '@/app/lib/brand';

const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matches DoneIsBetter's own published example

function clearOauthCookies(response: NextResponse) {
  response.cookies.delete('sso_oauth_state');
  response.cookies.delete('sso_code_verifier');
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    const response = NextResponse.redirect(new URL(`/access-denied?reason=${encodeURIComponent(errorParam)}`, request.url));
    clearOauthCookies(response);
    return response;
  }

  const expectedState = request.cookies.get('sso_oauth_state')?.value;
  const codeVerifier = request.cookies.get('sso_code_verifier')?.value;

  if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
    const response = NextResponse.json({ error: 'Invalid or missing OAuth state/code' }, { status: 400 });
    clearOauthCookies(response);
    return response;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    const claims = await verifyIdToken(tokens.id_token);
    const permission = await getPermission(claims.sub, tokens.access_token);

    // Issue #103: records every user who has ever signed in, regardless of
    // their DoneIsBetter-level permission status below, so the super admin
    // sees pending/revoked accounts in the admin UI too, not just approved
    // ones. Never blocks the redirect — a DB hiccup here shouldn't turn a
    // successful SSO login into a failed one. The record itself is reused
    // below to decide the redirect, rather than a second DB round trip.
    let userAccessRecord: SsoUserAccessRecord | null = null;
    if (isMongoConfigured() && claims.email) {
      try {
        const client = await clientPromise;
        const db = client.db();
        userAccessRecord = await upsertUserSeen(db, { ssoUserId: claims.sub, email: claims.email, name: claims.name });
      } catch (err) {
        console.error('[api/oauth/callback] upsertUserSeen failed:', err);
      }
    }

    const allBrands = Object.keys(await getAllBrandConfigs());
    const destination = resolveLoginDestination(permission?.status, claims.email, userAccessRecord?.orgAccess, allBrands);

    const response = NextResponse.redirect(new URL(destination, request.url));
    clearOauthCookies(response);

    const secureCookie = process.env.NODE_ENV === 'production';
    response.cookies.set('sso_access_token', tokens.access_token, {
      httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: tokens.expires_in,
    });
    response.cookies.set('sso_id_token', tokens.id_token, {
      httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: tokens.expires_in,
    });
    if (tokens.refresh_token) {
      response.cookies.set('sso_refresh_token', tokens.refresh_token, {
        httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', maxAge: REFRESH_TOKEN_MAX_AGE,
      });
    }
    return response;
  } catch (error: any) {
    console.error('[api/oauth/callback] error:', error);
    const response = NextResponse.json({ error: 'Authentication failed', details: error?.message }, { status: 500 });
    clearOauthCookies(response);
    return response;
  }
}
