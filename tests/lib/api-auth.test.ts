import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_KEY = process.env.SLG_API_KEY;

async function loadRequireApiKey() {
  vi.resetModules();
  const mod = await import('../../lib/api-auth');
  return mod.requireApiKey;
}

describe('requireApiKey', () => {
  afterEach(() => {
    process.env.SLG_API_KEY = ORIGINAL_KEY;
    vi.unstubAllEnvs();
  });

  it('allows the request through when SLG_API_KEY is unset outside production', async () => {
    delete process.env.SLG_API_KEY;
    vi.stubEnv('NODE_ENV', 'test');
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads'));
    expect(result).toBeNull();
  });

  // Issue #105: an unset SLG_API_KEY in production is a misconfiguration,
  // not a valid "no auth needed" state — must fail closed instead of
  // silently granting access to every route this guards.
  it('rejects with 401 when SLG_API_KEY is unset in production', async () => {
    delete process.env.SLG_API_KEY;
    vi.stubEnv('NODE_ENV', 'production');
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads'));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('rejects with 401 when SLG_API_KEY is set and no x-api-key header is sent', async () => {
    process.env.SLG_API_KEY = 'secret-key';
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads'));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('rejects with 401 when SLG_API_KEY is set and the wrong header is sent', async () => {
    process.env.SLG_API_KEY = 'secret-key';
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads', {
      headers: { 'x-api-key': 'wrong-key' },
    }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('allows the request through when the correct x-api-key header is sent', async () => {
    process.env.SLG_API_KEY = 'secret-key';
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads', {
      headers: { 'x-api-key': 'secret-key' },
    }));
    expect(result).toBeNull();
  });
});
