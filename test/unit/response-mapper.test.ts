import { pixResponseToAck } from '../../src/pix/response-mapper';
import type { PixPaymentResponse } from '../../src/pix/types';

describe('pixResponseToAck', () => {
  it('should map ACCEPTED response to ACCEPTED ack', () => {
    const response: PixPaymentResponse = {
      pix_tx_id: 'PIX-TX-001',
      status: 'ACCEPTED',
      valor: 5200,
      moeda: 'BRL',
      timestamp: '2026-01-01T00:00:00Z',
    };

    const ack = pixResponseToAck(response);

    expect(ack.rail_tx_id).toBe('PIX-TX-001');
    expect(ack.status).toBe('ACCEPTED');
    expect(ack.error).toBeUndefined();
  });

  it('should map REJECTED response to REJECTED ack with error', () => {
    const response: PixPaymentResponse = {
      pix_tx_id: 'PIX-TX-002',
      status: 'REJECTED',
      valor: 1000,
      moeda: 'BRL',
      timestamp: '2026-01-01T00:00:00Z',
      erro_codigo: 'PIX_INSUFFICIENT_FUNDS',
      erro_mensagem: 'Saldo insuficiente na conta de origem',
    };

    const ack = pixResponseToAck(response);

    expect(ack.status).toBe('REJECTED');
    expect(ack.error).toEqual({
      code: 'PIX_INSUFFICIENT_FUNDS',
      message: 'Saldo insuficiente na conta de origem',
    });
  });

  it('should default error message when erro_mensagem is missing', () => {
    const response: PixPaymentResponse = {
      pix_tx_id: 'PIX-TX-003',
      status: 'REJECTED',
      valor: 100,
      moeda: 'BRL',
      timestamp: '2026-01-01T00:00:00Z',
      erro_codigo: 'PIX_GENERIC',
    };

    const ack = pixResponseToAck(response);

    expect(ack.error?.message).toBe('Unknown PIX error');
  });
});
