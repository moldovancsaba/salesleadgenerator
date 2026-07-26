// Extracted to its own module (not exported from a route.ts file) — Next's
// route-file type validation only permits recognized handler exports
// (GET/POST/etc.) from a route.ts, so a route-file export of this helper
// fails the generated route-type check even though it's a plain function.

const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_-]+$/;

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_RE.test(value);
}
