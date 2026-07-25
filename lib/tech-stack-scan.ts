import * as http from 'http';
import * as https from 'https';
import { lookup as dnsLookupCb } from 'dns';
import { promisify } from 'util';

// This is the first place in this app's backend that makes an outbound HTTP
// request to an arbitrary, externally-supplied host (a lead's own `url`
// field) — SSRF defenses are the load-bearing part of this module, not an
// afterthought. Guard chain, enforced on every hop including redirects:
// 1. Scheme must be http:/https: only.
// 2. Resolve DNS ourselves; reject private/reserved/loopback/link-local
//    (including the 169.254.169.254 cloud metadata address) ranges.
// 3. Connect using that SAME resolved IP (via Node's http(s) `lookup`
//    option, which overrides DNS resolution at connect time) — the request
//    still targets the original hostname for Host header / TLS SNI, but
//    the TCP connection can never resolve to a different (rebound) address
//    between our check and the actual connection.
// 4. Redirects capped at 3, each target re-validated from step 1.
// 5. Response body capped at 512 KB, streamed and aborted past that, not
//    fully downloaded then truncated.
// 6. 5000ms total timeout, enforced by this module regardless of what the
//    underlying request does.

const dnsLookupAsync = promisify(dnsLookupCb);

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'SalesLeadGenerator-TechScan/1.0';
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type TechScanStatus = 'ok' | 'blocked' | 'timeout' | 'invalid_url' | 'non_html' | 'error';

export type TechScanResult = {
  status: TechScanStatus;
  signals: string[];
  scannedAt: string;
  httpStatus?: number;
};

export type IpResolution = { address: string; family: 4 | 6 };

export type FetchOutcome =
  | { kind: 'response'; statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }
  | { kind: 'timeout' }
  | { kind: 'network-error'; message: string };

export type ResolveIpFn = (hostname: string) => Promise<IpResolution>;
export type PerformRequestFn = (targetUrl: URL, ip: IpResolution, timeoutMs: number, maxBodyBytes: number) => Promise<FetchOutcome>;

export type ScanTechStackDeps = {
  resolveIp?: ResolveIpFn;
  performRequest?: PerformRequestFn;
  now?: () => Date;
  timeoutMs?: number;
};

// IPv4 private/reserved ranges: RFC1918 (10/8, 172.16/12, 192.168/16),
// loopback (127/8), link-local incl. cloud metadata (169.254/16),
// "this network" (0/8), CGNAT (100.64/8), documentation/test ranges
// (192.0.2/24, 198.51.100/24, 203.0.113/24), benchmarking (198.18/15),
// IETF protocol assignments (192.0.0/24), multicast (224/4), reserved
// (240/4), and the broadcast address.
function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true; // multicast (224-239) + reserved (240-255) + broadcast

  return false;
}

// IPv6: loopback (::1), unspecified (::), unique local (fc00::/7),
// link-local (fe80::/10), and IPv4-mapped addresses (::ffff:a.b.c.d) —
// unwrapped and checked against the IPv4 rules above.
function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // fe80::/10

  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isPrivateOrReservedIpv4(mappedMatch[1]);

  return false;
}

export function isPrivateOrReservedIp(address: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateOrReservedIpv4(address) : isPrivateOrReservedIpv6(address);
}

// Returns null (not a thrown error) for anything not a well-formed http(s)
// URL — callers treat null as invalid_url, never attempting a fetch.
export function parseTargetUrl(rawUrl: string): URL | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

// Ordered signature table — first-found-per-signature, not mutually
// exclusive (a site can legitimately match several). Deliberately small and
// conservative: false negatives (a real CMS/tool missed) are expected and
// acceptable; a JS-rendered site with no server-side markers produces zero
// signals by design, not a bug (no headless browser here).
const SIGNATURES: Array<[string, RegExp]> = [
  ['wordpress', /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i],
  ['wix', /<meta[^>]+content=["']Wix\.com/i],
  ['squarespace', /Squarespace\.(afterBodyLoad|Config)/i],
  ['webflow', /data-wf-site=/i],
  ['shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['google-analytics', /gtag\(['"]config['"]|UA-\d{4,10}-\d/],
  ['gtm', /googletagmanager\.com\/gtm\.js/i],
  ['meta-pixel', /connect\.facebook\.net.+fbevents\.js/i],
  ['hubspot', /js\.hs-scripts\.com|hsforms\.net/i],
  ['nextjs', /__NEXT_DATA__|\/_next\/static\//i],
  ['react', /data-reactroot|__NEXT_DATA__/i],
  ['vue', /id=["']app["'][^>]*data-v-|Vue\.createApp/i],
];

export function matchSignatures(html: string): string[] {
  if (typeof html !== 'string' || !html) return [];
  return SIGNATURES.filter(([, re]) => re.test(html)).map(([name]) => name);
}

async function defaultResolveIp(hostname: string): Promise<IpResolution> {
  const result = await dnsLookupAsync(hostname);
  return { address: result.address, family: result.family as 4 | 6 };
}

function defaultPerformRequest(targetUrl: URL, ip: IpResolution, timeoutMs: number, maxBodyBytes: number): Promise<FetchOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: FetchOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const client = targetUrl.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Host: targetUrl.host },
      timeout: timeoutMs,
      // Overrides DNS resolution at connect time with the address we
      // already validated — the request is still made "to" targetUrl.hostname
      // (correct Host header / TLS SNI), but can never connect to a
      // different, rebound address.
      lookup: (_hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, ip.address, ip.family);
      },
    } as http.RequestOptions, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        if (received > maxBodyBytes) {
          settle({ kind: 'response', statusCode: res.statusCode || 0, headers: res.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks) });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        settle({ kind: 'response', statusCode: res.statusCode || 0, headers: res.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks) });
      });
      res.on('error', (err) => settle({ kind: 'network-error', message: err.message }));
    });

    req.on('timeout', () => {
      req.destroy();
      settle({ kind: 'timeout' });
    });
    req.on('error', (err) => settle({ kind: 'network-error', message: err.message }));
    req.end();
  });
}

function contentTypeIsHtml(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = headers['content-type'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.toLowerCase().includes('text/html');
}

function resolveRedirectTarget(location: string, currentUrl: URL): URL | null {
  try {
    return new URL(location, currentUrl);
  } catch {
    return null;
  }
}

// Never throws — every failure mode (bad URL, blocked IP, timeout, network
// error, non-HTML response) resolves to a status, never a rejected promise,
// so a caller (the fire-and-forget POST hook) can always safely persist the
// result without its own try/catch.
export async function scanTechStack(rawUrl: string, deps?: ScanTechStackDeps): Promise<TechScanResult> {
  const resolveIp = deps?.resolveIp ?? defaultResolveIp;
  const performRequest = deps?.performRequest ?? defaultPerformRequest;
  const now = deps?.now ?? (() => new Date());
  const timeoutMs = deps?.timeoutMs ?? TIMEOUT_MS;

  const run = async (): Promise<TechScanResult> => {
    let currentUrl = parseTargetUrl(rawUrl);
    if (!currentUrl) {
      return { status: 'invalid_url', signals: [], scannedAt: now().toISOString() };
    }

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      let ip: IpResolution;
      try {
        ip = await resolveIp(currentUrl.hostname);
      } catch {
        return { status: 'error', signals: [], scannedAt: now().toISOString() };
      }

      if (isPrivateOrReservedIp(ip.address, ip.family)) {
        return { status: 'blocked', signals: [], scannedAt: now().toISOString() };
      }

      const outcome = await performRequest(currentUrl, ip, timeoutMs, MAX_BODY_BYTES);

      if (outcome.kind === 'timeout') {
        return { status: 'timeout', signals: [], scannedAt: now().toISOString() };
      }
      if (outcome.kind === 'network-error') {
        return { status: 'error', signals: [], scannedAt: now().toISOString() };
      }

      if (REDIRECT_STATUS_CODES.has(outcome.statusCode)) {
        const locationRaw = outcome.headers['location'];
        const location = Array.isArray(locationRaw) ? locationRaw[0] : locationRaw;
        if (location) {
          const redirectTarget = resolveRedirectTarget(location, currentUrl);
          if (!redirectTarget || (redirectTarget.protocol !== 'http:' && redirectTarget.protocol !== 'https:')) {
            return { status: 'invalid_url', signals: [], scannedAt: now().toISOString() };
          }
          currentUrl = redirectTarget;
          continue;
        }
      }

      if (outcome.statusCode < 200 || outcome.statusCode >= 300) {
        return { status: 'error', signals: [], scannedAt: now().toISOString(), httpStatus: outcome.statusCode };
      }

      if (!contentTypeIsHtml(outcome.headers)) {
        return { status: 'non_html', signals: [], scannedAt: now().toISOString(), httpStatus: outcome.statusCode };
      }

      return {
        status: 'ok',
        signals: matchSignatures(outcome.body.toString('utf-8')),
        scannedAt: now().toISOString(),
        httpStatus: outcome.statusCode,
      };
    }

    // Redirect cap exceeded.
    return { status: 'error', signals: [], scannedAt: now().toISOString() };
  };

  return Promise.race([
    run(),
    new Promise<TechScanResult>((resolve) => {
      setTimeout(() => resolve({ status: 'timeout', signals: [], scannedAt: now().toISOString() }), timeoutMs);
    }),
  ]);
}
