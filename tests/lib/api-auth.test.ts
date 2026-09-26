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

// Issue #224: a scheduled Vercel Cron call that is rejected must leave a clear
// log line, so an unset or mismatched CRON_SECRET is visible instead of
// showing up only as a bare 401 in runtime logs.
describe('requireCronOrApiKey', () => {
  const ORIGINAL_CRON = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.SLG_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_CRON === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = ORIGINAL_CRON;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function load() {
    vi.resetModules();
    const mod = await import('../../lib/api-auth');
    return mod.requireCronOrApiKey;
  }

  it('allows a request carrying the matching bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.SLG_API_KEY = 'secret-key';
    const guard = await load();
    const result = guard(new Request('https://example.com/api/admin/reports-tick', {
      headers: { authorization: 'Bearer cron-secret', 'x-vercel-cron-schedule': '0 * * * *' },
    }));
    expect(result).toBeNull();
  });

  it('logs that CRON_SECRET is not configured when a cron-scheduled request is rejected', async () => {
    delete process.env.CRON_SECRET;
    process.env.SLG_API_KEY = 'secret-key';
    vi.stubEnv('NODE_ENV', 'production');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = await load();
    const result = guard(new Request('https://example.com/api/admin/reports-tick', {
      headers: { 'x-vercel-cron-schedule': '0 * * * *' },
    }));
    expect(result?.status).toBe(401);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('CRON_SECRET is not configured');
    expect(line).toContain('/api/admin/reports-tick');
    expect(line).toContain('0 * * * *');
  });

  it('logs a mismatch when CRON_SECRET is set but the bearer value differs, without leaking either value', async () => {
    process.env.CRON_SECRET = 'real-cron-secret';
    process.env.SLG_API_KEY = 'secret-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = await load();
    const result = guard(new Request('https://example.com/api/admin/cadence-tick', {
      headers: { authorization: 'Bearer stale-cron-secret', 'x-vercel-cron-schedule': '0 8 * * *' },
    }));
    expect(result?.status).toBe(401);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('does not match CRON_SECRET');
    expect(line).not.toContain('real-cron-secret');
    expect(line).not.toContain('stale-cron-secret');
  });

  it('never treats the schedule header as an auth signal', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.SLG_API_KEY = 'secret-key';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = await load();
    const result = guard(new Request('https://example.com/api/admin/reports-tick', {
      headers: { 'x-vercel-cron-schedule': '0 * * * *' },
    }));
    expect(result?.status).toBe(401);
  });

  it('does not log for an ordinary non-cron request that fails x-api-key auth', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.SLG_API_KEY = 'secret-key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = await load();
    const result = guard(new Request('https://example.com/api/admin/reports-tick', {
      headers: { 'x-api-key': 'wrong-key' },
    }));
    expect(result?.status).toBe(401);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
