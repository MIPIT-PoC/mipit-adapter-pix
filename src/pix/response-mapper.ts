import type { PixPaymentResponse } from './types.js';

interface RailAck {
  rail_tx_id?: string;
  status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
  error?: { code: string; message: string };
  raw_response?: Record<string, unknown>;
}

export function pixResponseToAck(response: PixPaymentResponse): RailAck {
  return {
    rail_tx_id: response.pix_tx_id,
    status: response.status === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
    error: response.erro_codigo
      ? { code: response.erro_codigo, message: response.erro_mensagem ?? 'Unknown PIX error' }
      : undefined,
    raw_response: response as unknown as Record<string, unknown>,
  };
}
