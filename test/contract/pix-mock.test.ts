jest.mock('../../src/observability/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/config/env', () => ({
  env: {
    PIX_MOCK_PORT: 0,
    LOG_LEVEL: 'silent',
    OTEL_SERVICE_NAME: 'test',
  },
}));

import type { Server } from 'http';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { startMockServer } = await import('../../src/pix/mock-server');
  server = await startMockServer(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterAll((done) => {
  server?.close(done);
});

describe('PIX Mock Server Contract', () => {
  it('GET /health returns 200 with correct structure', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', service: 'pix-mock' });
  });

  it('POST /pix/payments with valid payload returns 200', async () => {
    const res = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pix_tx_ref: 'PMT-TEST',
        valor: 100.50,
        moeda: 'BRL',
        chaveOrigem: 'sender-key',
        chaveDestino: 'receiver-key',
        tipoChave: 'PIX_KEY',
        origem: 'PIX',
        destino: 'PIX',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pix_tx_id');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('valor');
    expect(body).toHaveProperty('moeda', 'BRL');
    expect(body).toHaveProperty('timestamp');
    expect(['ACCEPTED', 'REJECTED']).toContain(body.status);
  });

  it('response has error fields when REJECTED', async () => {
    const results: any[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${baseUrl}/pix/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor: 50, chaveOrigem: 'a', chaveDestino: 'b', tipoChave: 'PIX_KEY', origem: 'PIX', destino: 'PIX' }),
      });
      results.push(await res.json());
    }

    const rejected = results.filter((r: any) => r.status === 'REJECTED');
    if (rejected.length > 0) {
      expect(rejected[0]).toHaveProperty('erro_codigo');
      expect(rejected[0]).toHaveProperty('erro_mensagem');
    }
    expect(results.some((r: any) => r.status === 'ACCEPTED')).toBe(true);
  }, 30000);

  it('returns pix_tx_id starting with PIX-', async () => {
    const res = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor: 100, chaveOrigem: 'x', chaveDestino: 'y', tipoChave: 'PIX_KEY', origem: 'PIX', destino: 'PIX' }),
    });
    const body = await res.json();
    expect(body.pix_tx_id).toMatch(/^PIX-/);
  });
});
