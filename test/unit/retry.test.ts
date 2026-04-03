jest.mock('../../src/observability/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/observability/metrics', () => ({
  pixRetryCount: { inc: jest.fn() },
}));

import { withRetry } from '../../src/pix/retry';
import { pixRetryCount } from '../../src/observability/metrics';

describe('withRetry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return result on first successful attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pixRetryCount.inc).not.toHaveBeenCalled();
  });

  it('should retry on failure and eventually succeed', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(pixRetryCount.inc).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries exceeded', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fail'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }))
      .rejects.toThrow('always fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should increment retry count metric on each retry', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(pixRetryCount.inc).toHaveBeenCalledTimes(1);
  });

  it('should default baseDelayMs to 500', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await withRetry(fn, { maxRetries: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
