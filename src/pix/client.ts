import { env } from '../config/env.js';
import { withRetry } from './retry.js';
import type { PixPaymentRequest, PixPaymentResponse } from './types.js';
import { logger } from '../observability/logger.js';

export async function sendPixPayment(payload: PixPaymentRequest): Promise<PixPaymentResponse> {
  return withRetry(async () => {
    const url = `${env.PIX_SANDBOX_URL}/pix/payments`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.PIX_TIMEOUT_MS);

    try {
      logger.debug({ url, pix_tx_ref: payload.pix_tx_ref }, 'Sending PIX payment');

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`PIX sandbox error: ${res.status} — ${body}`);
      }

      return (await res.json()) as PixPaymentResponse;
    } finally {
      clearTimeout(timeout);
    }
  }, { maxRetries: env.PIX_MAX_RETRIES });
}
