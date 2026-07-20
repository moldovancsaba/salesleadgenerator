export interface RetryOptions {
  maxRetries?: number;
  retryableStatuses?: number[];
  backoffMs?: number;
  maxBackoffMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRYABLE_STATUSES = [502, 503, 504, 429];
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 2000;

export async function withRetry<T>(work: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const retryableStatuses = options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await work();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries) {
        break;
      }

      if (!isRetryable(error, retryableStatuses)) {
        break;
      }

      if (options.shouldRetry && !options.shouldRetry(error, attempt + 1)) {
        break;
      }

      const delay = Math.min(backoffMs * 2 ** attempt, maxBackoffMs);
      await sleep(delay);
      attempt++;
    }
  }

  throw lastError;
}

function isRetryable(error: unknown, retryableStatuses: number[]): boolean {
  if (!error || typeof error !== 'object') return false;

  const anyError = error as Partial<{
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  }>;

  if (typeof anyError.status === 'number' && retryableStatuses.includes(anyError.status)) {
    return true;
  }

  if (typeof anyError.code === 'string') {
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(anyError.code);
  }

  if (typeof anyError.name === 'string' && anyError.name === 'AbortError') {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
