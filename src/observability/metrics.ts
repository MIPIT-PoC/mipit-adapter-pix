import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// ─── Legacy per-rail metric names (kept for backward compatibility) ─────
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

// ─── P07: Unified adapter metrics with `rail` label ───────────────────────
// Dashboards (mipit-observability/grafana/dashboards/*.json) query these
// names with rail label. Audit found PIX/SPEI dashboards 0-populated because
// they queried label `rail` that didn't exist in per-rail names.

const RAIL = 'PIX';

export const adapterRequestsTotal = new client.Counter({
  name: 'mipit_adapter_requests_total',
  help: 'Total adapter requests by rail and status (P07 unified metric)',
  labelNames: ['rail', 'status'] as const,
  registers: [registry],
});

export const adapterLatencyMs = new client.Histogram({
  name: 'mipit_adapter_latency_ms',
  help: 'Adapter request latency in ms by rail',
  labelNames: ['rail'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const adapterRetriesTotal = new client.Counter({
  name: 'mipit_adapter_retries_total',
  help: 'Adapter retries by rail',
  labelNames: ['rail'] as const,
  registers: [registry],
});

export const adapterErrorsTotal = new client.Counter({
  name: 'mipit_adapter_errors_total',
  help: 'Adapter errors by rail and error code',
  labelNames: ['rail', 'error'] as const,
  registers: [registry],
});

/** P07 — record() helper that updates BOTH legacy + unified metrics. */
export function recordAdapterRequest(status: 'success' | 'rejected' | 'error', latencyMs?: number, errorCode?: string): void {
  pixPaymentsTotal.inc({ status });
  adapterRequestsTotal.inc({ rail: RAIL, status: status.toUpperCase() });
  if (latencyMs !== undefined) {
    pixPaymentLatency.observe({ status }, latencyMs);
    adapterLatencyMs.observe({ rail: RAIL }, latencyMs);
  }
  if (errorCode) {
    adapterErrorsTotal.inc({ rail: RAIL, error: errorCode });
  }
}

export function recordAdapterRetry(): void {
  pixRetryCount.inc();
  adapterRetriesTotal.inc({ rail: RAIL });
}
