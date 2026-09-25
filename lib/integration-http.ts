// Shared outbound-call helper for issue #217's third-party integration hub
// (Google's and Calendly's REST APIs, both called with plain fetch() per
// the issue's own zero-new-dependency constraint). A 10-second timeout and
// exponential backoff specifically on 429/5xx, matching issue #207 §16's
// identical Google-API-quota-respecting convention — never a busy-retry
// loop, and never retried on a 4xx that isn't 429 (that's a real rejection,
// not a transient one).

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { maxRetries?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      return res;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw error;
    }
  }
}
