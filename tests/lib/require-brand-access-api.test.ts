import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireBrandAccessApi } from '../../lib/require-brand-access-api';

// Issue #104: route-handler equivalent of lib/require-brand-access.ts's
// page-level gate, applied to the core lead data API. Only the branches
// reachable without a real signed SSO JWT are covered here (same
// constraint as tests/integration/admin-session-auth.integration.test.ts —
// this sandbox has no way to mint one), but those branches are exactly the
// ones that were previously entirely unguarded: no credentials at all, and
// the API-key short-circuit machine callers rely on.

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/leads?brand=cogmap', { headers });
}

const originalApiKey = process.env.SLG_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.SLG_API_KEY;
  } else {
    process.env.SLG_API_KEY = originalApiKey;
  }
});

describe('requireBrandAccessApi', () => {
  it('rejects a request with no x-api-key and no session cookie', async () => {
    process.env.SLG_API_KEY = 'real-key';
    const result = await requireBrandAccessApi(req(), 'cogmap');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('rejects a wrong x-api-key and no session cookie', async () => {
    process.env.SLG_API_KEY = 'real-key';
    const result = await requireBrandAccessApi(req({ 'x-api-key': 'wrong-key' }), 'cogmap');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('accepts a correct x-api-key with no session', async () => {
    process.env.SLG_API_KEY = 'real-key';
    const result = await requireBrandAccessApi(req({ 'x-api-key': 'real-key' }), 'cogmap');
    expect(result).toBeNull();
  });

  it('does not fail open when SLG_API_KEY is unset, unlike requireApiKey', async () => {
    delete process.env.SLG_API_KEY;
    const result = await requireBrandAccessApi(req({ 'x-api-key': 'anything' }), 'cogmap');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
