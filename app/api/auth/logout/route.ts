import { NextRequest, NextResponse } from 'next/server';

function clearAuthCookies(response: NextResponse) {
  response.cookies.delete('sso_access_token');
  response.cookies.delete('sso_id_token');
  response.cookies.delete('sso_refresh_token');
  response.cookies.delete('sso_oauth_state');
  response.cookies.delete('sso_code_verifier');
}

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, redirectTo: '/' });
  clearAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/', request.url));
  clearAuthCookies(response);
  return response;
}
