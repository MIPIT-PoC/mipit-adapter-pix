import { pixResponseToAck } from '../../src/pix/response-mapper';
import type { PixSpiPaymentResponse } from '../../src/pix/types';

describe('pixResponseToAck', () => {
  it('should map CONCLUIDA response to ACCEPTED ack', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-001',
      valor: '5200.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'CONCLUIDA',
      pagador: {
        ispb: '26264220',
        nome: 'João Silva',
      },
      recebedor: {
        ispb: '26264220',
        nome: 'Maria Santos',
      },
    };

    const ack = pixResponseToAck(response);

    expect(ack.rail_tx_id).toBe('SPI-TX-001');
    expect(ack.status).toBe('ACCEPTED');
    expect(ack.error).toBeUndefined();
    expect(ack.raw_response).toBeDefined();
  });

  it('should map NAO_REALIZADA response to REJECTED ack with error code', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-002',
      valor: '1000.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'NAO_REALIZADA',
      codigoErro: 'AM04',
      mensagemErro: 'Fundos insuficientes na conta do ordenante',
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    };

    const ack = pixResponseToAck(response);

    expect(ack.status).toBe('REJECTED');
    expect(ack.error?.code).toBe('AM04');
    expect(ack.error?.message).toBe('Fundos insuficientes na conta do ordenante');
  });

  it('should map DEVOLVIDA response to REJECTED ack with refund indicator', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-003',
      valor: '500.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'DEVOLVIDA',
      motivo: 'Devolvida pelo recebedor — dados incorretos',
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    };

    const ack = pixResponseToAck(response);

    expect(ack.status).toBe('REJECTED');
    expect(ack.error?.code).toBe('PIX_DEVOLVIDA');
    expect(ack.error?.message).toContain('Devolvida');
  });

  it('should map EM_PROCESSAMENTO response to ERROR ack (timeout scenario)', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-006',
      valor: '100.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'EM_PROCESSAMENTO',
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    };

    const ack = pixResponseToAck(response);

    expect(ack.status).toBe('ERROR');
    expect(ack.error?.code).toBe('PIX_EM_PROCESSAMENTO');
    expect(ack.error?.message).toContain('timeout');
  });

  it('should use motivo as fallback for mensagemErro when missing', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-004',
      valor: '100.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'NAO_REALIZADA',
      codigoErro: 'RR01',
      motivo: 'Dados da conta inválidos',
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    };

    const ack = pixResponseToAck(response);

    expect(ack.error?.message).toBe('Dados da conta inválidos');
  });

  it('should use fallback message when both mensagemErro and motivo are missing', () => {
    const response: PixSpiPaymentResponse = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-005',
      valor: '100.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'NAO_REALIZADA',
      codigoErro: 'AB03',
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    };

    const ack = pixResponseToAck(response);

    expect(ack.error?.message).toBe('Transação não realizada pelo SPI');
  });

  it('should handle unknown status gracefully', () => {
    // Create a response with an invalid status and cast as unknown first
    const response = {
      endToEndId: 'E123456789012345678901234567890',
      id: 'SPI-TX-007',
      valor: '100.00',
      horario: '2026-01-01T00:00:00.000Z',
      status: 'INVALID_STATUS' as any, // Force invalid status for testing
      pagador: { ispb: '26264220' },
      recebedor: { ispb: '26264220' },
    } as PixSpiPaymentResponse;

    const ack = pixResponseToAck(response);

    expect(ack.status).toBe('ERROR');
    expect(ack.error?.code).toBe('PIX_UNKNOWN_STATUS');
  });
});
