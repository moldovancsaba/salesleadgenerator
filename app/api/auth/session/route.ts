import { NextRequest, NextResponse } from 'next/server';
import { errors as joseErrors } from 'jose';
import { getPermission, refreshTokens, verifyIdToken } from '@/lib/sso';

const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

export async function GET(request: NextRequest) {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const accessToken = request.cookies.get('sso_access_token')?.value;
  const refreshToken = request.cookies.get('sso_refresh_token')?.value;

  if (!idToken || !accessToken) {
    return NextResponse.json({ user: null, permission: null }, { status: 401 });
  }

  try {
    const claims = await verifyIdToken(idToken);
    const permission = await getPermission(claims.sub, accessToken);
    return NextResponse.json({
      user: { id: claims.sub, email: claims.email, name: claims.name, emailVerified: claims.email_verified },
      permission,
    });
  } catch (error) {
    // Their own error-handling guidance: an expired ID token should attempt
    // a silent refresh before falling back to "not authenticated" — never
    // surfaced to the user as an error if a valid refresh_token can recover it.
    const expired = error instanceof joseErrors.JWTExpired;
    if (expired && refreshToken) {
      try {
        const tokens = await refreshTokens(refreshToken);
        const claims = await verifyIdToken(tokens.id_token);
        const permission = await getPermission(claims.sub, tokens.access_token);

        const response = NextResponse.json({
          user: { id: claims.sub, email: claims.email, name: claims.name, emailVerified: claims.email_verified },
          permission,
        });
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

    const response = NextResponse.json({ user: null, permission: null }, { status: 401 });
    response.cookies.delete('sso_access_token');
    response.cookies.delete('sso_id_token');
    response.cookies.delete('sso_refresh_token');
    return response;
  }
}
