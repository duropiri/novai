/**
 * Retry utility with exponential backoff
 * Handles rate limiting (429) and other transient errors
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 5,
  initialDelayMs: 2000,      // Start with 2 seconds
  maxDelayMs: 120000,        // Max 2 minutes
  backoffMultiplier: 2,      // Double each time
  retryableErrors: [
    '429',
    'RESOURCE_EXHAUSTED',
    'rate limit',
    'too many requests',
    'quota exceeded',
    'overloaded',
    'temporarily unavailable',
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry on transient errors
 * Uses exponential backoff with jitter to prevent thundering herd
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message.toLowerCase();

      // Check if error is retryable
      const isRetryable = opts.retryableErrors.some(
        e => errorMessage.includes(e.toLowerCase()),
      );

      if (!isRetryable || attempt === opts.maxRetries) {
        throw lastError;
      }

      // Add jitter (0-30% of delay) to prevent thundering herd
      const jitter = Math.random() * 0.3 * delay;
      const waitTime = Math.min(delay + jitter, opts.maxDelayMs);

      // Call onRetry callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, lastError, waitTime);
      }

      await sleep(waitTime);
      delay *= opts.backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Parse retry-after header from error response
 * Returns delay in milliseconds, or null if not present
 */
export function parseRetryAfter(error: Error): number | null {
  const match = error.message.match(/retry.?after[:\s]*(\d+)/i);
  if (match) {
    const seconds = parseInt(match[1], 10);
    return isNaN(seconds) ? null : seconds * 1000;
  }
  return null;
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultOptions: RetryOptions) {
  return function <T>(fn: () => Promise<T>, overrideOptions?: RetryOptions): Promise<T> {
    return withRetry(fn, { ...defaultOptions, ...overrideOptions });
  };
}
