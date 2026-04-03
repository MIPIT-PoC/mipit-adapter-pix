import type { PixSpiPaymentResponse } from './types.js';

export interface RailAck {
  rail_tx_id?: string;
  status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
  error?: { code: string; message: string };
  raw_response?: Record<string, unknown>;
}

/**
 * Maps a PIX SPI response to the MIPIT internal RailAck format.
 * BACEN SPI statuses:
 *   CONCLUIDA       → ACCEPTED
 *   NAO_REALIZADA   → REJECTED (with BACEN error code)
 *   DEVOLVIDA       → REJECTED (refunded)
 *   EM_PROCESSAMENTO → treated as ERROR (timeout / pending)
 */
export function pixResponseToAck(response: PixSpiPaymentResponse): RailAck {
  const railTxId = response.id ?? response.endToEndId;

  switch (response.status) {
    case 'CONCLUIDA':
      return {
        rail_tx_id: railTxId,
        status: 'ACCEPTED',
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'NAO_REALIZADA':
      return {
        rail_tx_id: railTxId,
        status: 'REJECTED',
        error: {
          code: response.codigoErro ?? 'PIX_REJECTED',
          message: response.mensagemErro ?? response.motivo ?? 'Transação não realizada pelo SPI',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'DEVOLVIDA':
      return {
        rail_tx_id: railTxId,
        status: 'REJECTED',
        error: {
          code: 'PIX_DEVOLVIDA',
          message: response.motivo ?? 'Transação devolvida pelo recebedor',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    case 'EM_PROCESSAMENTO':
      return {
        rail_tx_id: railTxId,
        status: 'ERROR',
        error: {
          code: 'PIX_EM_PROCESSAMENTO',
          message: 'Transação ainda em processamento no SPI — timeout atingido pelo adapter',
        },
        raw_response: response as unknown as Record<string, unknown>,
      };

    default:
      return {
        rail_tx_id: railTxId,
        status: 'ERROR',
        error: {
          code: 'PIX_UNKNOWN_STATUS',
          message: `Status SPI desconhecido: ${(response as PixSpiPaymentResponse).status}`,
        },
        raw_response: response as unknown as Record<string, unknown>,
      };
  }
}
