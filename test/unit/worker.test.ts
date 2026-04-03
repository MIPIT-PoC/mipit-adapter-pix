jest.mock('../../src/observability/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/observability/metrics', () => ({
  pixPaymentsTotal: { inc: jest.fn() },
  pixPaymentLatency: { observe: jest.fn() },
  pixRetryCount: { inc: jest.fn() },
}));

jest.mock('../../src/config/env', () => ({
  env: {
    QUEUE_NAME: 'payments.route.pix',
    EXCHANGE_NAME: 'mipit.payments',
    ACK_ROUTING_KEY: 'ack.pix',
    INSTANCE_ID: 'pix-test',
  },
}));

jest.mock('../../src/pix/mapper', () => ({
  canonicalToPixPayload: jest.fn().mockReturnValue({
    pix_tx_ref: 'PMT-001',
    valor: 100,
    moeda: 'BRL',
    chaveOrigem: 'sender',
    chaveDestino: 'receiver',
    tipoChave: 'PIX_KEY',
    origem: 'PIX',
    destino: 'PIX',
  }),
}));

jest.mock('../../src/pix/client', () => ({
  sendPixPayment: jest.fn().mockResolvedValue({
    pix_tx_id: 'PIX-TX-001',
    status: 'ACCEPTED',
    valor: 100,
    moeda: 'BRL',
    timestamp: '2026-01-01T00:00:00Z',
  }),
}));

jest.mock('../../src/pix/response-mapper', () => ({
  pixResponseToAck: jest.fn().mockReturnValue({
    rail_tx_id: 'PIX-TX-001',
    status: 'ACCEPTED',
  }),
}));

jest.mock('../../src/messaging/publisher', () => ({
  publishAck: jest.fn(),
}));

import { startWorker } from '../../src/worker';
import { publishAck } from '../../src/messaging/publisher';
import { sendPixPayment } from '../../src/pix/client';
import { pixPaymentsTotal, pixPaymentLatency } from '../../src/observability/metrics';

function createMockChannel() {
  const consumers: Array<(msg: any) => Promise<void>> = [];
  return {
    prefetch: jest.fn(),
    consume: jest.fn((_queue: string, handler: any) => {
      consumers.push(handler);
    }),
    ack: jest.fn(),
    nack: jest.fn(),
    publish: jest.fn(),
    _deliver: async (content: object) => {
      const msg = { content: Buffer.from(JSON.stringify(content)) };
      await consumers[0]?.(msg);
    },
    _deliverRaw: async (raw: string) => {
      const msg = { content: Buffer.from(raw) };
      await consumers[0]?.(msg);
    },
    _deliverNull: async () => {
      await consumers[0]?.(null);
    },
  };
}

describe('startWorker', () => {
  let channel: ReturnType<typeof createMockChannel>;

  beforeEach(async () => {
    jest.clearAllMocks();
    channel = createMockChannel();
    await startWorker(channel as any);
  });

  it('should set prefetch to 1', () => {
    expect(channel.prefetch).toHaveBeenCalledWith(1);
  });

  it('should consume from the configured queue', () => {
    expect(channel.consume).toHaveBeenCalledWith('payments.route.pix', expect.any(Function));
  });

  it('should process a valid message and ack', async () => {
    await channel._deliver({
      payment_id: 'PMT-001',
      trace_id: 'trace-001',
      canonical: { payment_id: 'PMT-001' },
      destination_rail: 'PIX',
    });

    expect(publishAck).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(pixPaymentsTotal.inc).toHaveBeenCalledWith({ status: 'success' });
    expect(pixPaymentLatency.observe).toHaveBeenCalled();
  });

  it('should nack invalid JSON messages', async () => {
    await channel._deliverRaw('not-json{{{');

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('should ignore null messages', async () => {
    await channel._deliverNull();

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('should publish FAILED ack and nack on processing error', async () => {
    (sendPixPayment as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

    await channel._deliver({
      payment_id: 'PMT-FAIL',
      trace_id: 'trace-fail',
      canonical: { payment_id: 'PMT-FAIL' },
      destination_rail: 'PIX',
    });

    expect(publishAck).toHaveBeenCalledTimes(1);
    const ackMsg = (publishAck as jest.Mock).mock.calls[0][1];
    expect(ackMsg.status).toBe('FAILED');
    expect(ackMsg.rail_ack.status).toBe('ERROR');
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(pixPaymentsTotal.inc).toHaveBeenCalledWith({ status: 'error' });
  });
});
