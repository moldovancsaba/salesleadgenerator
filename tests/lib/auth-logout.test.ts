import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../../app/api/auth/logout/route';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Auth Logout Route & In-App Redirection', () => {
  it('POST /api/auth/logout clears auth cookies and redirects in-app to / without external ssoLogoutUrl', async () => {
    const req = new NextRequest('https://salesleadgenerator.vercel.app/api/auth/logout', {
      method: 'POST',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ssoLogoutUrl).toBeUndefined();
    expect(body.redirectTo).toBe('/');

    // Verify deleted cookies
    const setCookieHeaders = res.headers.getSetCookie();
    const deletedCookies = setCookieHeaders.map((c) => c.split('=')[0]);
    expect(deletedCookies).toContain('sso_access_token');
    expect(deletedCookies).toContain('sso_id_token');
    expect(deletedCookies).toContain('sso_refresh_token');
  });

  it('GET /api/auth/logout redirects to / of current origin', async () => {
    const req = new NextRequest('https://salesleadgenerator.vercel.app/api/auth/logout', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get('location')).toBe('https://salesleadgenerator.vercel.app/');

    const setCookieHeaders = res.headers.getSetCookie();
    const deletedCookies = setCookieHeaders.map((c) => c.split('=')[0]);
    expect(deletedCookies).toContain('sso_access_token');
    expect(deletedCookies).toContain('sso_id_token');
  });

  it('AuthProvider does not redirect away to sso.doneisbetter.com on logout', () => {
    const code = readFileSync(join(__dirname, '..', '..', 'app', 'components', 'AuthProvider.tsx'), 'utf8');
    expect(code).not.toContain('ssoLogoutUrl');
    expect(code).toContain("window.location.href = '/'");
  });
});
