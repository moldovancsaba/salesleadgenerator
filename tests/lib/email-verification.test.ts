import { describe, it, expect, vi } from 'vitest';
import {
  verifyEmail,
  lookupMx,
  isRoleAccount,
  isFreeProvider,
  extractDomain,
} from '../../lib/email-verification';
import type { ResolverLike } from '../../lib/email-verification';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const noopDelay = () => Promise.resolve();

function fakeResolver(opts: {
  resolveMx?: () => Promise<Array<{ priority: number; exchange: string }>>;
  resolve4?: () => Promise<string[]>;
}): { resolver: ResolverLike; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const resolver: ResolverLike = {
    resolveMx: opts.resolveMx ?? (() => Promise.reject(Object.assign(new Error('no mx'), { code: 'ENODATA' }))),
    resolve4: opts.resolve4 ?? (() => Promise.reject(Object.assign(new Error('no a'), { code: 'ENODATA' }))),
    cancel,
  };
  return { resolver, cancel };
}

describe('isRoleAccount', () => {
  it('flags known role-account local parts, case-insensitively', () => {
    expect(isRoleAccount('info')).toBe(true);
    expect(isRoleAccount('INFO')).toBe(true);
    expect(isRoleAccount('sales')).toBe(true);
    expect(isRoleAccount('jane.doe')).toBe(false);
  });
});

describe('isFreeProvider', () => {
  it('flags known free-mail domains, case-insensitively', () => {
    expect(isFreeProvider('gmail.com')).toBe(true);
    expect(isFreeProvider('GMAIL.COM')).toBe(true);
    expect(isFreeProvider('acmecorp.com')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('extracts and lowercases the domain', () => {
    expect(extractDomain('Jane@ACME.com')).toBe('acme.com');
  });

  it('returns null for a string with no @', () => {
    expect(extractDomain('not-an-email')).toBeNull();
  });
});

describe('lookupMx', () => {
  it('returns ok:true with sorted hosts when MX records exist', async () => {
    const { resolver } = fakeResolver({
      resolveMx: () => Promise.resolve([{ priority: 10, exchange: 'mx2.example.com' }, { priority: 5, exchange: 'mx1.example.com' }]),
    });
    const result = await lookupMx('example.com', 3000, () => resolver);
    expect(result).toEqual({ ok: true, hosts: ['mx1.example.com', 'mx2.example.com'] });
  });

  it('falls back to the A record per RFC 5321 when MX has no records (ENODATA)', async () => {
    const { resolver } = fakeResolver({
      resolveMx: () => Promise.reject(Object.assign(new Error('no mx'), { code: 'ENODATA' })),
      resolve4: () => Promise.resolve(['203.0.113.1']),
    });
    const result = await lookupMx('example.com', 3000, () => resolver);
    expect(result).toEqual({ ok: true, hosts: ['example.com'] });
  });

  it('returns ok:false reason no-mx-no-a when neither MX nor A resolve', async () => {
    const { resolver } = fakeResolver({
      resolveMx: () => Promise.reject(Object.assign(new Error('no mx'), { code: 'ENODATA' })),
      resolve4: () => Promise.reject(Object.assign(new Error('no a'), { code: 'ENODATA' })),
    });
    const result = await lookupMx('example.com', 3000, () => resolver);
    expect(result).toEqual({ ok: false, reason: 'no-mx-no-a' });
  });

  it('returns reason:nxdomain, not transient, for ENOTFOUND', async () => {
    const { resolver } = fakeResolver({
      resolveMx: () => Promise.reject(Object.assign(new Error('nxdomain'), { code: 'ENOTFOUND' })),
    });
    const result = await lookupMx('does-not-exist.invalid', 3000, () => resolver);
    expect(result).toEqual({ ok: false, reason: 'nxdomain' });
  });

  it('treats an unexpected resolver error (e.g. SERVFAIL) as transient', async () => {
    const { resolver } = fakeResolver({
      resolveMx: () => Promise.reject(Object.assign(new Error('servfail'), { code: 'SERVFAIL' })),
    });
    const result = await lookupMx('example.com', 3000, () => resolver);
    expect(result).toEqual({ ok: false, reason: 'SERVFAIL', transient: true });
  });

  it('resolves as a timeout, calling resolver.cancel(), rather than hanging', async () => {
    const { resolver, cancel } = fakeResolver({
      resolveMx: () => new Promise(() => {}), // never resolves
    });
    const start = Date.now();
    const result = await lookupMx('slow.example.com', 20, () => resolver);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toEqual({ ok: false, reason: 'timeout', transient: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('verifyEmail', () => {
  it('short-circuits to unverified for a malformed email, never calling resolveMx', async () => {
    const resolveMx = vi.fn();
    const resolverFactory = () => fakeResolver({ resolveMx }).resolver;
    const result = await verifyEmail('not-an-email', { resolverFactory, now: () => NOW, delayFn: noopDelay });
    expect(result).toEqual({ status: 'unverified', checkedAt: null, isRoleAccount: false, isFreeProvider: false, error: 'invalid-format' });
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('returns mx-verified with mxHosts for a domain with real MX records', async () => {
    const { resolver } = fakeResolver({ resolveMx: () => Promise.resolve([{ priority: 10, exchange: 'mx.acme.com' }]) });
    const result = await verifyEmail('jane@acme.com', { resolverFactory: () => resolver, now: () => NOW, delayFn: noopDelay });
    expect(result).toEqual({
      status: 'mx-verified',
      checkedAt: NOW.toISOString(),
      isRoleAccount: false,
      isFreeProvider: false,
      mxHosts: ['mx.acme.com'],
    });
  });

  it('returns mx-failed for NXDOMAIN, with isRoleAccount detected independently of the MX result', async () => {
    const { resolver } = fakeResolver({ resolveMx: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) });
    const result = await verifyEmail('info@does-not-exist.invalid', { resolverFactory: () => resolver, now: () => NOW, delayFn: noopDelay });
    expect(result.status).toBe('mx-failed');
    expect(result.isRoleAccount).toBe(true);
    expect(result.error).toBe('nxdomain');
  });

  it('retries a transient failure up to 2 additional times before giving up as check-error', async () => {
    let calls = 0;
    const resolveMx = vi.fn(() => {
      calls++;
      return Promise.reject(Object.assign(new Error('servfail'), { code: 'SERVFAIL' }));
    });
    const resolve4 = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { code: 'ENODATA' })));
    const delayFn = vi.fn(() => Promise.resolve());
    const result = await verifyEmail('jane@flaky.example.com', {
      resolverFactory: () => ({ resolveMx, resolve4, cancel: vi.fn() }),
      now: () => NOW,
      delayFn,
    });
    expect(result.status).toBe('check-error');
    expect(calls).toBe(3); // initial attempt + 2 retries
    expect(delayFn).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenNthCalledWith(1, 1000);
    expect(delayFn).toHaveBeenNthCalledWith(2, 3000);
  });

  it('stops retrying as soon as a retry succeeds', async () => {
    let calls = 0;
    const resolveMx = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.reject(Object.assign(new Error('servfail'), { code: 'SERVFAIL' }));
      return Promise.resolve([{ priority: 10, exchange: 'mx.acme.com' }]);
    });
    const result = await verifyEmail('jane@acme.com', {
      resolverFactory: () => ({ resolveMx, resolve4: vi.fn(), cancel: vi.fn() }),
      now: () => NOW,
      delayFn: noopDelay,
    });
    expect(result.status).toBe('mx-verified');
    expect(calls).toBe(2);
  });

  it('never retries a definitive mx-failed result', async () => {
    const resolveMx = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })));
    const delayFn = vi.fn(() => Promise.resolve());
    const result = await verifyEmail('jane@nowhere.invalid', {
      resolverFactory: () => ({ resolveMx, resolve4: vi.fn(), cancel: vi.fn() }),
      now: () => NOW,
      delayFn,
    });
    expect(result.status).toBe('mx-failed');
    expect(resolveMx).toHaveBeenCalledOnce();
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('flags a free-provider domain independently of the MX result', async () => {
    const { resolver } = fakeResolver({ resolveMx: () => Promise.resolve([{ priority: 10, exchange: 'gmail-smtp-in.l.google.com' }]) });
    const result = await verifyEmail('jane@gmail.com', { resolverFactory: () => resolver, now: () => NOW, delayFn: noopDelay });
    expect(result.isFreeProvider).toBe(true);
    expect(result.status).toBe('mx-verified');
  });

  it('never throws, even when the resolver factory itself misbehaves', async () => {
    const resolver: ResolverLike = { resolveMx: () => Promise.reject(new Error('boom')), resolve4: () => Promise.reject(new Error('boom')), cancel: vi.fn() };
    await expect(verifyEmail('jane@example.com', { resolverFactory: () => resolver, now: () => NOW, delayFn: noopDelay })).resolves.toBeDefined();
  });
});
