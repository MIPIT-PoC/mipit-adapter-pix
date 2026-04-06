/**
 * OAuth2 Client Credentials Mock — PIX (BACEN)
 *
 * Simulates the BACEN mTLS/OAuth2 authentication flow.
 * Real PIX SPI requires:
 *   1. mTLS certificate signed by ICP-Brasil
 *   2. OAuth2 client_credentials grant with certificate-bound access tokens
 *
 * This mock simplifies to standard client_credentials for the PoC,
 * demonstrating the auth pattern without real PKI infrastructure.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { logger } from '../observability/logger.js';

interface TokenEntry {
  token: string;
  clientId: string;
  expiresAt: number;
  scope: string;
}

const VALID_CLIENTS: Record<string, string> = {
  'mipit-core': 'mipit-secret-pix-2024',
  'mipit-test': 'test-secret-pix',
};

const TOKEN_TTL_MS = 3600_000; // 1 hour

const activeTokens = new Map<string, TokenEntry>();

export function registerOAuth2Routes(app: Express): void {
  app.post('/oauth/token', (req: Request, res: Response) => {
    const { grant_type, client_id, client_secret, scope } = req.body;

    if (grant_type !== 'client_credentials') {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only client_credentials grant is supported by BACEN SPI.',
      });
    }

    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required.',
      });
    }

    if (VALID_CLIENTS[client_id] !== client_secret) {
      logger.warn({ client_id }, 'OAuth2: invalid credentials');
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed.',
      });
    }

    const token = `pix_${crypto.randomBytes(32).toString('hex')}`;
    const entry: TokenEntry = {
      token,
      clientId: client_id,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      scope: scope ?? 'spi.pagamentos',
    };
    activeTokens.set(token, entry);

    logger.info({ client_id, scope: entry.scope }, 'OAuth2: token issued');

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_MS / 1000,
      scope: entry.scope,
    });
  });
}

export function oauthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health, oauth, and admin endpoints
  if (req.path === '/health' || req.path.startsWith('/oauth') || req.path.startsWith('/admin')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'invalid_token',
      error_description: 'Bearer token required. Obtain one via POST /oauth/token.',
    });
    return;
  }

  const token = authHeader.slice(7);
  const entry = activeTokens.get(token);

  if (!entry) {
    res.status(401).json({ error: 'invalid_token', error_description: 'Token not recognized.' });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    activeTokens.delete(token);
    res.status(401).json({ error: 'invalid_token', error_description: 'Token expired.' });
    return;
  }

  next();
}
