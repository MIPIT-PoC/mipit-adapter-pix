import { env } from '../config/env.js';
import { withRetry } from './retry.js';
import type { PixSpiPaymentRequest, PixSpiPaymentResponse } from './types.js';
import { logger } from '../observability/logger.js';

export async function sendPixPayment(payload: PixSpiPaymentRequest): Promise<PixSpiPaymentResponse> {
  return withRetry(async () => {
    // Try real SPI endpoint; mock server handles /spi/v2/pagamentos and /pix/payments
    const url = `${env.PIX_SANDBOX_URL}/spi/v2/pagamentos`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.PIX_TIMEOUT_MS);

    try {
      logger.debug({ url, endToEndId: payload.endToEndId }, 'Sending PIX SPI payment');

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

      return (await res.json()) as PixSpiPaymentResponse;
    } finally {
      clearTimeout(timeout);
    }
  }, { maxRetries: env.PIX_MAX_RETRIES });
}
