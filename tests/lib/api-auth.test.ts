import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_KEY = process.env.SLG_API_KEY;

async function loadRequireApiKey() {
  vi.resetModules();
  const mod = await import('../../lib/api-auth');
  return mod.requireApiKey;
}

describe('requireApiKey', () => {
  afterEach(() => {
    process.env.SLG_API_KEY = ORIGINAL_KEY;
  });

  it('allows the request through when SLG_API_KEY is unset', async () => {
    delete process.env.SLG_API_KEY;
    const requireApiKey = await loadRequireApiKey();
    const result = requireApiKey(new Request('https://example.com/api/leads'));
    expect(result).toBeNull();
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
