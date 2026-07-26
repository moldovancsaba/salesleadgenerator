import { NextRequest, NextResponse } from 'next/server';
import { SSO_BASE_URL } from '@/lib/sso';

// Their own docs list `GET /api/oauth/logout` in the API reference as the
// endpoint that "terminates hosted SSO session" for OAuth clients — the
// published React example instead calls `/api/public/logout`, which isn't
// in the documented API reference at all (likely the hosted login UI's own
// session endpoint, not the OAuth client one). Following the documented API
// reference, not the inconsistent example.
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, ssoLogoutUrl: `${SSO_BASE_URL}/api/oauth/logout` });
  response.cookies.delete('sso_access_token');
  response.cookies.delete('sso_id_token');
  response.cookies.delete('sso_refresh_token');
  return response;
}
