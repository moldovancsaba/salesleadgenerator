import { describe, it, expect, vi } from 'vitest';
import {
  scanTechStack,
  isPrivateOrReservedIp,
  matchSignatures,
  parseTargetUrl,
} from '../../lib/tech-stack-scan';
import type { FetchOutcome, IpResolution } from '../../lib/tech-stack-scan';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const REAL_PUBLIC_IP: IpResolution = { address: '93.184.216.34', family: 4 };

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8', statusCode = 200): FetchOutcome {
  return { kind: 'response', statusCode, headers: { 'content-type': contentType }, body: Buffer.from(body, 'utf-8') };
}

function redirectResponse(location: string, statusCode = 302): FetchOutcome {
  return { kind: 'response', statusCode, headers: { location }, body: Buffer.alloc(0) };
}

describe('isPrivateOrReservedIp', () => {
  it('flags RFC1918 private ranges', () => {
    expect(isPrivateOrReservedIp('10.0.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255', 4)).toBe(true);
    expect(isPrivateOrReservedIp('172.32.0.1', 4)).toBe(false); // just outside 172.16/12
    expect(isPrivateOrReservedIp('192.168.1.1', 4)).toBe(true);
  });

  it('flags loopback and link-local, including the cloud metadata address', () => {
    expect(isPrivateOrReservedIp('127.0.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254', 4)).toBe(true);
    expect(isPrivateOrReservedIp('169.254.1.1', 4)).toBe(true);
  });

  it('flags CGNAT, documentation ranges, multicast, and reserved space', () => {
    expect(isPrivateOrReservedIp('100.64.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('192.0.2.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('198.51.100.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('203.0.113.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('224.0.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('255.255.255.255', 4)).toBe(true);
  });

  it('allows real public IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('93.184.216.34', 4)).toBe(false);
    expect(isPrivateOrReservedIp('8.8.8.8', 4)).toBe(false);
  });

  it('flags IPv6 loopback, unique-local, and link-local ranges', () => {
    expect(isPrivateOrReservedIp('::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fd12:3456::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1', 6)).toBe(true);
  });

  it('unwraps and checks an IPv4-mapped IPv6 address', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:93.184.216.34', 6)).toBe(false);
  });

  it('allows a real public IPv6 address', () => {
    expect(isPrivateOrReservedIp('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false);
  });
});

describe('parseTargetUrl', () => {
  it('accepts well-formed http/https URLs', () => {
    expect(parseTargetUrl('https://example.com')?.href).toBe('https://example.com/');
    expect(parseTargetUrl('http://example.com/path')?.href).toBe('http://example.com/path');
  });

  it('rejects a non-http(s) scheme', () => {
    expect(parseTargetUrl('ftp://example.com')).toBeNull();
    expect(parseTargetUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects a malformed string without throwing', () => {
    expect(() => parseTargetUrl('not a url')).not.toThrow();
    expect(parseTargetUrl('not a url')).toBeNull();
    expect(parseTargetUrl('')).toBeNull();
  });
});

describe('matchSignatures', () => {
  it('matches a WordPress generator meta tag', () => {
    const html = '<html><head><meta name="generator" content="WordPress 6.4" /></head></html>';
    expect(matchSignatures(html)).toContain('wordpress');
  });

  it('matches GTM and Google Analytics markers together', () => {
    const html = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script><script>gtag('config', 'UA-12345-1');</script>`;
    const signals = matchSignatures(html);
    expect(signals).toContain('gtm');
    expect(signals).toContain('google-analytics');
  });

  it('returns an empty array for a page with no recognized markers', () => {
    expect(matchSignatures('<html><body>Hello</body></html>')).toEqual([]);
  });
});

describe('scanTechStack', () => {
  it('returns the wordpress signal for a generator meta tag', async () => {
    const performRequest = vi.fn().mockResolvedValue(
      htmlResponse('<meta name="generator" content="WordPress 6.4" />')
    );
    const result = await scanTechStack('https://example.com', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('ok');
    expect(result.signals).toContain('wordpress');
    expect(result.scannedAt).toBe(NOW.toISOString());
  });

  it('returns non_html for a JSON content-type response', async () => {
    const performRequest = vi.fn().mockResolvedValue(htmlResponse('{"ok":true}', 'application/json'));
    const result = await scanTechStack('https://example.com/api', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('non_html');
    expect(result.signals).toEqual([]);
  });

  it('resolves as a timeout, within the configured window, when the request hangs', async () => {
    const performRequest = vi.fn(() => new Promise<FetchOutcome>(() => {})); // never resolves
    const start = Date.now();
    const result = await scanTechStack('https://example.com', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
      timeoutMs: 50,
    });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.status).toBe('timeout');
  });

  it('blocks a target resolving to 127.0.0.1 without ever attempting a fetch', async () => {
    const performRequest = vi.fn();
    const result = await scanTechStack('https://internal.example.com', {
      resolveIp: async () => ({ address: '127.0.0.1', family: 4 }),
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('blocked');
    expect(performRequest).not.toHaveBeenCalled();
  });

  it('blocks a target resolving to the cloud metadata address without ever attempting a fetch', async () => {
    const performRequest = vi.fn();
    const result = await scanTechStack('https://metadata.example.com', {
      resolveIp: async () => ({ address: '169.254.169.254', family: 4 }),
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('blocked');
    expect(performRequest).not.toHaveBeenCalled();
  });

  it('follows a redirect chain within the cap and returns the final page\'s signals', async () => {
    const performRequest = vi.fn()
      .mockResolvedValueOnce(redirectResponse('https://step2.example.com/'))
      .mockResolvedValueOnce(redirectResponse('https://step3.example.com/'))
      .mockResolvedValueOnce(htmlResponse('<meta name="generator" content="WordPress" />'));
    const result = await scanTechStack('https://step1.example.com', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('ok');
    expect(result.signals).toContain('wordpress');
    expect(performRequest).toHaveBeenCalledTimes(3);
  });

  it('returns error when the redirect chain exceeds the cap', async () => {
    const performRequest = vi.fn()
      .mockResolvedValueOnce(redirectResponse('https://step2.example.com/'))
      .mockResolvedValueOnce(redirectResponse('https://step3.example.com/'))
      .mockResolvedValueOnce(redirectResponse('https://step4.example.com/'))
      .mockResolvedValueOnce(redirectResponse('https://step5.example.com/'));
    const result = await scanTechStack('https://step1.example.com', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('error');
  });

  it('blocks when a redirect target resolves to a private IP (DNS-rebinding-via-redirect case)', async () => {
    const performRequest = vi.fn().mockResolvedValueOnce(redirectResponse('https://internal.example.com/'));
    let call = 0;
    const resolveIp = vi.fn(async () => {
      call++;
      return call === 1 ? REAL_PUBLIC_IP : { address: '10.0.0.5', family: 4 as const };
    });
    const result = await scanTechStack('https://step1.example.com', {
      resolveIp,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('blocked');
    expect(performRequest).toHaveBeenCalledTimes(1); // never fetches the redirect target
  });

  it('returns invalid_url for a malformed URL without ever resolving DNS', async () => {
    const resolveIp = vi.fn();
    const result = await scanTechStack('not a url', { resolveIp, now: () => NOW });
    expect(result.status).toBe('invalid_url');
    expect(resolveIp).not.toHaveBeenCalled();
  });

  it('returns invalid_url for a non-http(s) scheme without ever resolving DNS', async () => {
    const resolveIp = vi.fn();
    const result = await scanTechStack('ftp://example.com', { resolveIp, now: () => NOW });
    expect(result.status).toBe('invalid_url');
    expect(resolveIp).not.toHaveBeenCalled();
  });

  it('returns error, never throwing, on a DNS resolution failure', async () => {
    const result = await scanTechStack('https://does-not-resolve.invalid', {
      resolveIp: async () => { throw new Error('ENOTFOUND'); },
      now: () => NOW,
    });
    expect(result.status).toBe('error');
  });

  it('returns error on a non-2xx, non-redirect HTTP status', async () => {
    const performRequest = vi.fn().mockResolvedValue({ kind: 'response', statusCode: 500, headers: {}, body: Buffer.alloc(0) } satisfies FetchOutcome);
    const result = await scanTechStack('https://example.com', {
      resolveIp: async () => REAL_PUBLIC_IP,
      performRequest,
      now: () => NOW,
    });
    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(500);
  });

  it('never throws on a network-level error from performRequest', async () => {
    const performRequest = vi.fn().mockResolvedValue({ kind: 'network-error', message: 'ECONNRESET' } satisfies FetchOutcome);
    await expect(
      scanTechStack('https://example.com', { resolveIp: async () => REAL_PUBLIC_IP, performRequest, now: () => NOW })
    ).resolves.toMatchObject({ status: 'error' });
  });
});
