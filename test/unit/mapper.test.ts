import { canonicalToPixPayload } from '../../src/pix/mapper';

describe('canonicalToPixPayload', () => {
  it('should map canonical payment to PIX payload', () => {
    const canonical = {
      payment_id: 'PAY-001',
      amount: { value: 1000, currency: 'USD' },
      fx: { rate: 5.2 },
      debtor: { account_id: 'PIX-chave-origem-123', name: 'João Silva' },
      creditor: { account_id: 'PIX-chave-destino-456', name: 'Maria Santos' },
      alias: { type: 'PIX_KEY', value: 'chave-destino-456' },
      purpose: 'Pagamento de serviços',
      reference: 'REF-12345',
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
      trace_id: 'trace-001',
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.pix_tx_ref).toBe('PAY-001');
    expect(result.valor).toBe(5200);
    expect(result.moeda).toBe('BRL');
    expect(result.chaveOrigem).toBe('chave-origem-123');
    expect(result.chaveDestino).toBe('chave-destino-456');
    expect(result.nomePagador).toBe('João Silva');
    expect(result.nomeRecebedor).toBe('Maria Santos');
    expect(result.tipoChave).toBe('PIX_KEY');
    expect(result.trace).toBe('trace-001');
  });

  it('should default fx rate to 1 when not provided', () => {
    const canonical = {
      payment_id: 'PAY-002',
      amount: { value: 500, currency: 'BRL' },
      debtor: { account_id: 'chave-origem' },
      creditor: { account_id: 'chave-destino' },
      alias: { type: 'PIX_KEY', value: 'chave-destino' },
      origin: { rail: 'PIX' },
      destination: {},
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.valor).toBe(500);
    expect(result.destino).toBe('PIX');
  });

  it('should truncate purpose to 35 chars and reference to 140 chars', () => {
    const canonical = {
      payment_id: 'PAY-003',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: 'origem' },
      creditor: { account_id: 'destino' },
      alias: { type: 'PIX_KEY', value: 'destino' },
      purpose: 'A'.repeat(50),
      reference: 'B'.repeat(200),
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.finalidade).toHaveLength(35);
    expect(result.mensagem).toHaveLength(140);
  });
});
