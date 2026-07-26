import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// Regression coverage for a real, confirmed vulnerability: GET/PUT
// /api/prompts and GET/PUT /api/admin/toggle had no authentication at all —
// anyone with the URL could read/write the autonomous research agent's
// discovery/enrichment prompts and per-tenant automation toggles. Both now
// require a super-admin session, matching /api/admin/users and
// /api/admin/duplicate-scan.
//
// A real signed session JWT can't be fabricated in this sandbox (no private
// key), so this only confirms the auth gate actually fires for an
// unauthenticated request — not the full authenticated-success path, which
// the owner already verified for the equivalent /api/admin/users pattern in
// production.

function reqWithoutSession(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${url}`, init);
}

describe('GET/PUT /api/prompts — requires a super-admin session', () => {
  it('GET rejects a request with no session cookie', async () => {
    const { GET } = await import('../../app/api/prompts/route');
    const res = await GET(reqWithoutSession('/api/prompts?brand=cogmap&tenantId=default&type=discovery'));
    expect(res.status).toBe(401);
  });

  it('PUT rejects a request with no session cookie', async () => {
    const { PUT } = await import('../../app/api/prompts/route');
    const res = await PUT(reqWithoutSession('/api/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', tenantId: 'default', type: 'discovery', content: 'x' }),
    }));
    expect(res.status).toBe(401);
  });

  it('PUT rejects a path-traversal tenantId even before the auth check would matter, confirmed 401 not 500/200', async () => {
    const { PUT } = await import('../../app/api/prompts/route');
    const res = await PUT(reqWithoutSession('/api/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', tenantId: '../../../../tmp/pwned', type: 'discovery', content: 'x' }),
    }));
    // Auth is checked first, so an unauthenticated traversal attempt never
    // even reaches the tenantId validation — still correctly blocked either way.
    expect(res.status).toBe(401);
  });
});

describe('GET/PUT /api/admin/toggle — requires a super-admin session', () => {
  it('GET rejects a request with no session cookie', async () => {
    const { GET } = await import('../../app/api/admin/toggle/route');
    const res = await GET(reqWithoutSession('/api/admin/toggle?brand=cogmap'));
    expect(res.status).toBe(401);
  });

  it('PUT rejects a request with no session cookie', async () => {
    const { PUT } = await import('../../app/api/admin/toggle/route');
    const res = await PUT(reqWithoutSession('/api/admin/toggle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'cogmap', operation: 'discovery', enabled: true }),
    }));
    expect(res.status).toBe(401);
  });
});
