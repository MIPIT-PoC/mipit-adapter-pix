import { env } from '../config/env.js';
import { withRetry } from './retry.js';
import type { PixSpiPaymentRequest, PixSpiPaymentResponse } from './types.js';
import { logger } from '../observability/logger.js';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${env.PIX_SANDBOX_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'mipit-core',
      client_secret: 'mipit-secret-pix-2024',
      scope: 'spi.pagamentos',
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.info('PIX OAuth2 token acquired');
  return cachedToken.token;
}

export async function sendPixPayment(payload: PixSpiPaymentRequest): Promise<PixSpiPaymentResponse> {
  return withRetry(async () => {
    const url = `${env.PIX_SANDBOX_URL}/spi/v2/pagamentos`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.PIX_TIMEOUT_MS);

    try {
      const token = await getOAuthToken();
      logger.debug({ url, endToEndId: payload.endToEndId }, 'Sending PIX SPI payment');

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Token expired — retry with fresh token
      if (res.status === 401) {
        cachedToken = null;
        const newToken = await getOAuthToken();
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!retryRes.ok) {
          const body = await retryRes.text();
          throw new Error(`PIX sandbox error after token refresh: ${retryRes.status} — ${body}`);
        }
        return (await retryRes.json()) as PixSpiPaymentResponse;
      }

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
