import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const pixPaymentsTotal = new client.Counter({
  name: 'mipit_adapter_pix_payments_total',
  help: 'Total PIX payments processed by this adapter',
  labelNames: ['status'],
  registers: [registry],
});

export const pixPaymentLatency = new client.Histogram({
  name: 'mipit_adapter_pix_payment_latency_ms',
  help: 'PIX payment processing latency in milliseconds',
  labelNames: ['status'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const pixRetryCount = new client.Counter({
  name: 'mipit_adapter_pix_retries_total',
  help: 'Total retry attempts for PIX payments',
  registers: [registry],
});
