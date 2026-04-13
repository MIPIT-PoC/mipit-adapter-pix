jest.mock('../../src/observability/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/config/env', () => ({
  env: {
    EXCHANGE_NAME: 'mipit.payments',
    ACK_ROUTING_KEY: 'ack.pix',
  },
}));

import { publishAck } from '../../src/messaging/publisher';
import type { PaymentAckMessage } from '../../src/worker';

describe('publishAck', () => {
  it('should publish JSON message to the correct exchange and routing key', () => {
    const channel = { publish: jest.fn() };
    const now = new Date().toISOString();
    const message: PaymentAckMessage = {
      payment_id: 'PMT-001',
      trace_id: 'trace-001',
      source_rail: 'PIX',
      adapter_id: 'pix-adapter-01',
      instance_id: 'pod-01',
      status: 'ACKED_BY_RAIL',
      rail_ack: {
        rail_tx_id: 'SPI-TX-001',
        status: 'ACCEPTED',
      },
      latency_ms: 245,
      processed_at: now,
    };

    publishAck(channel as any, message);

    expect(channel.publish).toHaveBeenCalledWith(
      'mipit.payments',
      'ack.pix',
      expect.any(Buffer),
      { persistent: true, contentType: 'application/json' },
    );
  });

  it('should serialize message as JSON in the buffer', () => {
    const channel = { publish: jest.fn() };
    const now = new Date().toISOString();
    const message: PaymentAckMessage = {
      payment_id: 'PMT-002',
      trace_id: 'trace-002',
      source_rail: 'PIX',
      adapter_id: 'pix-adapter-01',
      instance_id: 'pod-01',
      status: 'FAILED',
      rail_ack: {
        status: 'ERROR',
        error: {
          code: 'PIX_TIMEOUT',
          message: 'PIX SPI timeout after 3 retries',
        },
      },
      latency_ms: 15000,
      processed_at: now,
    };

    publishAck(channel as any, message);

    const buffer = channel.publish.mock.calls[0][2] as Buffer;
    const parsed = JSON.parse(buffer.toString());
    expect(parsed.payment_id).toBe('PMT-002');
    expect(parsed.status).toBe('FAILED');
    expect(parsed.rail_ack.error.code).toBe('PIX_TIMEOUT');
  });

  it('should include all required fields in published message', () => {
    const channel = { publish: jest.fn() };
    const now = new Date().toISOString();
    const message: PaymentAckMessage = {
      payment_id: 'PMT-003',
      trace_id: 'trace-003',
      source_rail: 'PIX',
      adapter_id: 'pix-adapter-01',
      instance_id: 'pod-01',
      status: 'REJECTED',
      rail_ack: {
        rail_tx_id: 'SPI-TX-003',
        status: 'REJECTED',
        error: {
          code: 'AM04',
          message: 'Fundos insuficientes',
        },
      },
      latency_ms: 890,
      processed_at: now,
    };

    publishAck(channel as any, message);

    const buffer = channel.publish.mock.calls[0][2] as Buffer;
    const parsed = JSON.parse(buffer.toString()) as PaymentAckMessage;
    
    expect(parsed.payment_id).toBeDefined();
    expect(parsed.trace_id).toBeDefined();
    expect(parsed.source_rail).toBeDefined();
    expect(parsed.adapter_id).toBeDefined();
    expect(parsed.instance_id).toBeDefined();
    expect(parsed.status).toBeDefined();
    expect(parsed.rail_ack).toBeDefined();
    expect(parsed.latency_ms).toBeDefined();
    expect(parsed.processed_at).toBeDefined();
  });
});
