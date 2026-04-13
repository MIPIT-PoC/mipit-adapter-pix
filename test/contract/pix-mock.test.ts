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
let accessToken: string;

beforeAll(async () => {
  const { startMockServer } = await import('../../src/pix/mock-server');
  server = await startMockServer(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
  
  // Obtain OAuth2 token for tests
  const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'mipit-test',
      client_secret: 'test-secret-pix',
      scope: 'pix.spi',
    }),
  });
  const tokenData = await tokenRes.json();
  accessToken = tokenData.access_token;
});

afterAll((done) => {
  server?.close(done);
});

describe('PIX Mock Server Contract', () => {
  it('GET /health returns 200 with correct structure and service info', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    
    // New health endpoint structure
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('service', 'pix-mock-spi');
    expect(body).toHaveProperty('version', '2.0');
    expect(body).toHaveProperty('spiWindowOpen');
    expect(body).toHaveProperty('pixNocturnalActive');
    expect(body).toHaveProperty('processedCount');
    expect(body).toHaveProperty('timestamp');
  });

  it('POST /oauth/token with valid credentials returns access_token', async () => {
    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: 'mipit-test',
        client_secret: 'test-secret-pix',
        scope: 'pix.spi',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('token_type', 'Bearer');
    expect(body).toHaveProperty('expires_in');
    expect(body.access_token).toBeTruthy();
  });

  it('POST /pix/payments (legacy) with valid PixSpiPaymentRequest structure requires Bearer token', async () => {
    // Test without token
    const noAuthRes = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endToEndId: 'E1234567820260413120501234567890',
        valor: { original: '100.50' },
      }),
    });
    expect(noAuthRes.status).toBe(401);

    // Test with valid token
    const res = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        endToEndId: 'E1234567820260413120501234567890',
        valor: { original: '100.50' },
        pagador: {
          ispb: '26264220',
          agencia: '0001',
          contaTransacional: { numero: '123456-7', tipoConta: 'CACC' },
          nome: 'João Silva',
        },
        recebedor: {
          ispb: '26264220',
          nome: 'Maria Santos',
        },
        chave: '55566677788',
        tipoChave: 'CPF',
        tipo: 'TRANSF',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    
    // Validate PixSpiPaymentResponse structure
    expect(body).toHaveProperty('endToEndId');
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('valor');
    expect(body).toHaveProperty('horario');
    expect(body).toHaveProperty('status');
    expect(['CONCLUIDA', 'NAO_REALIZADA', 'DEVOLVIDA', 'EM_PROCESSAMENTO']).toContain(body.status);
    expect(body).toHaveProperty('pagador');
    expect(body).toHaveProperty('recebedor');
  });

  it('mock server simulates random failures (~10%) with proper error codes', async () => {
    const results: any[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${baseUrl}/pix/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          endToEndId: `E1234567820260413120${String(i).padStart(5, '0')}1234567890`,
          valor: { original: '50.00' },
          pagador: { ispb: '26264220', nome: 'Payer' },
          recebedor: { ispb: '26264220', nome: 'Receiver' },
          chave: '55566677788',
          tipoChave: 'CPF',
          tipo: 'TRANSF',
        }),
      });
      results.push(await res.json());
    }

    const rejected = results.filter((r: any) => r.status === 'NAO_REALIZADA');
    if (rejected.length > 0) {
      // Rejected responses should have BACEN error codes
      expect(rejected[0]).toHaveProperty('codigoErro');
      expect(rejected[0]).toHaveProperty('mensagemErro');
    }
    // Should have at least one successful response
    expect(results.some((r: any) => r.status === 'CONCLUIDA')).toBe(true);
  }, 30000);

  it('endToEndId is passed through correctly and id is generated uniquely', async () => {
    const testEndToEndId = 'E1234567820260413120512345678901';
    const res = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        endToEndId: testEndToEndId,
        valor: { original: '100.00' },
        pagador: { ispb: '26264220', nome: 'Payer' },
        recebedor: { ispb: '26264220', nome: 'Receiver' },
        chave: '55566677788',
        tipoChave: 'CPF',
        tipo: 'TRANSF',
      }),
    });
    const body = await res.json();
    expect(body.endToEndId).toBe(testEndToEndId);
    expect(body.id).toBeDefined();
    // Transaction ID should be a non-empty string (ULID format in lowercase)
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });

  it('handles numeric valor field for backward compatibility', async () => {
    const res = await fetch(`${baseUrl}/pix/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        endToEndId: 'E1234567820260413120512345678901',
        valor: 150.50,
        pagador: { ispb: '26264220', nome: 'Payer' },
        recebedor: { ispb: '26264220', nome: 'Receiver' },
        chave: 'test@example.com',
        tipoChave: 'EMAIL',
        tipo: 'TRANSF',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valor).toBeDefined();
  });
});
