jest.mock('../../src/observability/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/observability/metrics', () => ({
  registry: {
    contentType: 'text/plain',
    metrics: jest.fn().mockResolvedValue('# HELP test\ntest_metric 1'),
  },
}));

import type { Server } from 'http';
import { startHealthServer } from '../../src/health-server';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await startHealthServer(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterAll((done) => {
  server?.close(done);
});

describe('Health Server', () => {
  it('GET /health returns adapter status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', adapter: 'pix' });
  });

  it('GET /metrics returns prometheus metrics', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('test_metric');
  });
});
