import express from 'express';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

const app = express();
app.use(express.json());

app.post('/pix/payments', (req, res) => {
  const { valor } = req.body;

  const shouldFail = Math.random() < 0.1;

  if (shouldFail) {
    return res.status(200).json({
      pix_tx_id: `PIX-${ulid()}`,
      status: 'REJECTED',
      valor,
      moeda: 'BRL',
      timestamp: new Date().toISOString(),
      erro_codigo: 'PIX_INSUFFICIENT_FUNDS',
      erro_mensagem: 'Saldo insuficiente na conta de origem',
    });
  }

  const latency = 100 + Math.random() * 400;
  setTimeout(() => {
    res.status(200).json({
      pix_tx_id: `PIX-${ulid()}`,
      status: 'ACCEPTED',
      valor,
      moeda: 'BRL',
      timestamp: new Date().toISOString(),
    });
  }, latency);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pix-mock' }));

export function startMockServer() {
  const port = env.PIX_MOCK_PORT;
  app.listen(port, () => logger.info(`PIX mock sandbox running on port ${port}`));
}

if (process.argv[1]?.includes('mock-server')) {
  startMockServer();
}
