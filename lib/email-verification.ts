import { promises as dnsPromises } from 'dns';
import { EMAIL_RE } from './validate-lead';

// Proves the *domain* can receive mail (an MX record, or an A/AAAA fallback
// per RFC 5321 §5) — it does NOT and cannot prove any specific mailbox
// exists. A catch-all domain always verifies regardless of whether the
// local part is real; a typo'd local part at a real domain is
// indistinguishable from a correct one under this check. UI/docs copy must
// always say "verified domain," never "verified email."

export type MxLookupResult =
  | { ok: true; hosts: string[] }
  | { ok: false; reason: string; transient?: boolean };

export type EmailVerificationStatus = {
  status: 'unverified' | 'mx-verified' | 'mx-failed' | 'check-error';
  checkedAt: string | null;
  isRoleAccount: boolean;
  isFreeProvider: boolean;
  mxHosts?: string[];
  error?: string;
};

// Minimal shape this module needs from a DNS resolver — lets tests inject a
// fake resolver instead of mocking the whole 'dns' module.
export type ResolverLike = {
  resolveMx: (domain: string) => Promise<Array<{ priority: number; exchange: string }>>;
  resolve4: (domain: string) => Promise<string[]>;
  cancel: () => void;
};

const DEFAULT_TIMEOUT_MS = 3000;
// Retry schedule for transient failures only (timeout/SERVFAIL/etc.) — a
// definitive mx-failed (NXDOMAIN, confirmed no MX+no A) never retries.
const RETRY_DELAYS_MS = [1000, 3000];

const ROLE_PREFIXES = new Set([
  'info', 'admin', 'support', 'sales', 'contact', 'hello', 'office', 'help',
  'billing', 'marketing', 'careers', 'jobs', 'press', 'media', 'team',
  'noreply', 'no-reply', 'webmaster', 'postmaster', 'abuse', 'security',
]);

const FREE_PROVIDER_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'live.com', 'yandex.com',
]);

export function isRoleAccount(localPart: string): boolean {
  return ROLE_PREFIXES.has(String(localPart || '').toLowerCase());
}

export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDER_DOMAINS.has(String(domain || '').toLowerCase());
}

export function extractDomain(email: string): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

function defaultResolverFactory(): ResolverLike {
  return new dnsPromises.Resolver();
}

// dns.promises methods don't accept an AbortSignal (that's a fetch-only
// convention) — Node's actual cancellation mechanism for an in-flight
// Resolver query is Resolver#cancel(), which this races against a timer.
function withTimeout<T>(resolver: ResolverLike, promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolver.cancel();
      reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function lookupMx(
  domain: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  resolverFactory: () => ResolverLike = defaultResolverFactory
): Promise<MxLookupResult> {
  const resolver = resolverFactory();
  let mxRecords: Array<{ priority: number; exchange: string }> = [];

  try {
    mxRecords = await withTimeout(resolver, resolver.resolveMx(domain), timeoutMs);
  } catch (err: any) {
    if (err?.code === 'ENOTFOUND') return { ok: false, reason: 'nxdomain' };
    if (err?.code === 'ETIMEDOUT') return { ok: false, reason: 'timeout', transient: true };
    // ENODATA means the domain exists but has no MX records — fall through
    // to the A-record fallback below rather than treating it as a failure.
    if (err?.code !== 'ENODATA') return { ok: false, reason: err?.code || 'unknown', transient: true };
  }

  if (mxRecords.length > 0) {
    return { ok: true, hosts: mxRecords.map((r) => r.exchange).sort() };
  }

  // RFC 5321 §5 fallback: no MX records, but the domain itself resolves —
  // mail may still be deliverable to that host.
  try {
    const aRecords = await withTimeout(resolver, resolver.resolve4(domain), timeoutMs);
    if (aRecords.length > 0) return { ok: true, hosts: [domain] };
  } catch {
    // A-record lookup failing after an empty/absent MX just means no
    // fallback exists — not a distinct error worth surfacing over the
    // already-determined "no-mx-no-a" outcome below.
  }

  return { ok: false, reason: 'no-mx-no-a' };
}

export type VerifyEmailOptions = {
  timeoutMs?: number;
  resolverFactory?: () => ResolverLike;
  now?: () => Date;
  delayFn?: (ms: number) => Promise<void>;
};

export type CheckDomainOptions = {
  timeoutMs?: number;
  resolverFactory?: () => ResolverLike;
  delayFn?: (ms: number) => Promise<void>;
};

// Domain-level check with up to 2 retries with backoff (1s, 3s) for
// transient failures only — a definitive failure (nxdomain/no-mx-no-a)
// never retries. Exported separately from verifyEmail() so a caller
// verifying several contacts that share a domain (app/lib/email-verification-store.ts)
// can dedupe DNS lookups per domain instead of per contact.
export async function checkDomain(domain: string, options?: CheckDomainOptions): Promise<MxLookupResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolverFactory = options?.resolverFactory ?? defaultResolverFactory;
  const delayFn = options?.delayFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let mx = await lookupMx(domain, timeoutMs, resolverFactory);
  let attempt = 0;
  while (!mx.ok && mx.transient && attempt < RETRY_DELAYS_MS.length) {
    await delayFn(RETRY_DELAYS_MS[attempt]);
    attempt++;
    mx = await lookupMx(domain, timeoutMs, resolverFactory);
  }
  return mx;
}

// Exported so a caller that already has a domain-level MxLookupResult
// (e.g. app/lib/email-verification-store.ts, deduping one lookup across
// several contacts on the same domain) can build the per-contact status
// without duplicating this ok/transient/failed mapping.
export function statusFromMxResult(mx: MxLookupResult, checkedAt: string, roleAccount: boolean, freeProvider: boolean): EmailVerificationStatus {
  if (mx.ok) {
    return { status: 'mx-verified', checkedAt, isRoleAccount: roleAccount, isFreeProvider: freeProvider, mxHosts: mx.hosts };
  }
  if (mx.transient) {
    return { status: 'check-error', checkedAt, isRoleAccount: roleAccount, isFreeProvider: freeProvider, error: mx.reason };
  }
  return { status: 'mx-failed', checkedAt, isRoleAccount: roleAccount, isFreeProvider: freeProvider, error: mx.reason };
}

// Single per-contact verification (format check, then checkDomain()).
// Never throws: DNS failures of any kind resolve to a status, not a
// rejected promise, so a caller can always safely persist the result.
export async function verifyEmail(email: string, options?: VerifyEmailOptions): Promise<EmailVerificationStatus> {
  const now = options?.now ?? (() => new Date());

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return { status: 'unverified', checkedAt: null, isRoleAccount: false, isFreeProvider: false, error: 'invalid-format' };
  }

  const domain = extractDomain(email);
  if (!domain) {
    return { status: 'unverified', checkedAt: null, isRoleAccount: false, isFreeProvider: false, error: 'invalid-format' };
  }

  const localPart = email.slice(0, email.lastIndexOf('@'));
  const roleAccount = isRoleAccount(localPart);
  const freeProvider = isFreeProvider(domain);

  const mx = await checkDomain(domain, options);
  return statusFromMxResult(mx, now().toISOString(), roleAccount, freeProvider);
}
