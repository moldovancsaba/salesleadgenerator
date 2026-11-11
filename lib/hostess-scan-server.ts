/**
 * Server-only half of the check-in scanner's access control: which code a page accepts, a constant-time comparison,
 * and a per-instance brake on repeated wrong codes. Never import this from a client component (Node crypto).
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * The access code the scanner of a page accepts: the page's own code, else the shared `HOSTESS_SCAN_PASSWORD`
 * of the deployment, else none. No code means the scanner stays closed.
 */
export function scannerAccessCode(pageCode: string | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const own = pageCode?.trim();
  if (own) return own;
  const shared = env.HOSTESS_SCAN_PASSWORD?.trim();
  return shared || null;
}

/** Constant-time comparison, so response time does not reveal how much of a guess was right. */
export function accessCodeMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, number[]>();

/** True while a caller has used up its wrong-code attempts. Per server instance, so a best-effort brake rather than a hard limit. */
export function accessCodeLockedOut(key: string, now: number = Date.now()): boolean {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent.length >= MAX_FAILURES;
}

export function recordAccessCodeFailure(key: string, now: number = Date.now()): void {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  recent.push(now);
  failures.set(key, recent);
}

export function clearAccessCodeFailures(key: string): void {
  failures.delete(key);
}
