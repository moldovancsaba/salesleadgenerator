import { NextRequest, NextResponse } from 'next/server';
import { errors as joseErrors } from 'jose';
import { getPermission, refreshTokens, verifyIdToken, type SsoIdTokenClaims } from '@/lib/sso';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { getAccessibleBrands, getUserAccess, isSuperAdminEmail } from '@/lib/sso-access';
import { getAllBrandConfigs } from '@/app/lib/brand';

const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

// Read-only — never upserts (that only happens once, on login, in
// app/api/oauth/callback/route.ts). Called on every page's session check
// once AuthProvider is mounted, so no write per read.
async function buildSessionBody(claims: SsoIdTokenClaims, accessToken: string) {
  const permission = await getPermission(claims.sub, accessToken);

  // Issue #195 — resolved once here (this route already has DB access) and
  // threaded through: `allBrands` as the explicit parameter
  // getAccessibleBrands() now needs (keeps that function sync/DB-free, see
  // lib/sso-access.ts), and `brandLabels` so app/components/AppNav.tsx (a
  // Client Component, can't call the Mongo-backed brand accessors itself)
  // can render every configured brand's label without its own BRAND_CONFIG
  // import. Every brand's label ships regardless of the viewer's own
  // access — access is enforced elsewhere, this is purely "what is this
  // brand called," same visibility the old static BRAND_CONFIG import gave.
  const brandConfigs = await getAllBrandConfigs();
  const allBrands = Object.keys(brandConfigs);
  const brandLabels: Record<string, string> = {};
  for (const [slug, config] of Object.entries(brandConfigs)) brandLabels[slug] = config.label;

  let accessibleBrands: string[] = [];
  let hasSeenTour = false;
  if (isMongoConfigured()) {
    const client = await clientPromise;
    const db = client.db();
    const record = await getUserAccess(db, claims.sub);
    accessibleBrands = getAccessibleBrands(claims.email, record?.orgAccess, allBrands);
    hasSeenTour = Boolean(record?.tourSeenAt);
  } else if (isSuperAdminEmail(claims.email)) {
    // No DB configured (local dev without MONGODB_URI) — a super admin
    // still needs to see something rather than an empty nav, since
    // orgAccess can't be read at all in that state.
    accessibleBrands = getAccessibleBrands(claims.email, undefined, allBrands);
  }

  return {
    user: { id: claims.sub, email: claims.email, name: claims.name, emailVerified: claims.email_verified },
    permission,
    accessibleBrands,
    brandLabels,
    isSuperAdmin: isSuperAdminEmail(claims.email),
    hasSeenTour,
  };
}

export async function GET(request: NextRequest) {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const accessToken = request.cookies.get('sso_access_token')?.value;
  const refreshToken = request.cookies.get('sso_refresh_token')?.value;

  if (!idToken || !accessToken) {
    return NextResponse.json({ user: null, permission: null, accessibleBrands: [], brandLabels: {}, isSuperAdmin: false, hasSeenTour: false }, { status: 401 });
  }

  try {
    const claims = await verifyIdToken(idToken);
    return NextResponse.json(await buildSessionBody(claims, accessToken));
  } catch (error) {
    // Their own error-handling guidance: an expired ID token should attempt
    // a silent refresh before falling back to "not authenticated" — never
    // surfaced to the user as an error if a valid refresh_token can recover it.
    const expired = error instanceof joseErrors.JWTExpired;
    if (expired && refreshToken) {
      try {
        const tokens = await refreshTokens(refreshToken);
        const claims = await verifyIdToken(tokens.id_token);
        const body = await buildSessionBody(claims, tokens.access_token);

        const response = NextResponse.json(body);
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
      } catch (refreshError) {
        console.error('[api/auth/session] refresh failed:', refreshError);
      }
    } else {
      console.error('[api/auth/session] verification failed:', error);
    }

    const response = NextResponse.json({ user: null, permission: null, accessibleBrands: [], brandLabels: {}, isSuperAdmin: false, hasSeenTour: false }, { status: 401 });
    response.cookies.delete('sso_access_token');
    response.cookies.delete('sso_id_token');
    response.cookies.delete('sso_refresh_token');
    return response;
  }
}
