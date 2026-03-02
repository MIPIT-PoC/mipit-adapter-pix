import { logger } from '../observability/logger.js';

interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs = 500 } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn({ attempt, maxRetries, delay, err }, 'Retry after failure');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Unreachable');
}
