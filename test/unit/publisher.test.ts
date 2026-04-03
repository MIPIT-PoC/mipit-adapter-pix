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

describe('publishAck', () => {
  it('should publish JSON message to the correct exchange and routing key', () => {
    const channel = { publish: jest.fn() };
    const message = { payment_id: 'PMT-001', status: 'ACKED_BY_RAIL' };

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
    const message = { payment_id: 'PMT-002', data: 'test' };

    publishAck(channel as any, message);

    const buffer = channel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual(message);
  });
});
