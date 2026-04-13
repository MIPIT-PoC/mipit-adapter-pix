import { canonicalToPixPayload } from '../../src/pix/mapper';
import { PIX_ISPB } from '../../src/pix/types.js';

describe('canonicalToPixPayload', () => {
  it('should map canonical payment to PIX SPI payload with FX conversion', () => {
    const canonical = {
      payment_id: 'PMT-001',
      amount: { value: 1000, currency: 'USD' },
      fx: { rate: 5.2 },
      debtor: { account_id: 'PIX-11122233344', name: 'João Silva', agencia: '0001' },
      creditor: { account_id: 'PIX-55566677788', name: 'Maria Santos' },
      alias: { type: 'CPF', value: '55566677788' },
      reference: 'REF-12345',
      origin: { rail: 'PIX', ispb: PIX_ISPB.MIPIT_SIMULATED },
      destination: { rail: 'PIX', ispb: PIX_ISPB.MIPIT_SIMULATED },
    };

    const result = canonicalToPixPayload(canonical);

    // Validate SPI EndToEndId format: E + ISPB(8) + YYYYMMDD(8) + HHmm(4) + unique(11) = 32 chars total
    // Format: E (1) + digits (20) + alphanumeric (11) = 32 chars
    expect(result.endToEndId).toMatch(/^E\d{20}[A-Z0-9]{11}$/);
    // Validate amount conversion: 1000 USD * 5.2 rate = 5200.00 BRL
    expect(result.valor.original).toBe('5200.00');
    // Validate reconciliation ID (strip PMT- prefix, max 35 chars)
    expect(result.idConciliacao).toBe('001');
    // Validate payer structure
    expect(result.pagador.nome).toBe('João Silva');
    expect(result.pagador.ispb).toBe(PIX_ISPB.MIPIT_SIMULATED);
    expect(result.pagador.agencia).toBe('0001');
    // Validate receiver structure
    expect(result.recebedor.nome).toBe('Maria Santos');
    expect(result.recebedor.ispb).toBe(PIX_ISPB.MIPIT_SIMULATED);
    // Validate PIX key
    expect(result.chave).toBe('55566677788');
    expect(result.tipoChave).toBe('CPF');
    expect(result.tipo).toBe('TRANSF');
  });

  it('should default fx rate to 1 when not provided', () => {
    const canonical = {
      payment_id: 'PMT-002',
      amount: { value: 500, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '55566677788' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.valor.original).toBe('500.00');
    expect(result.tipo).toBe('TRANSF');
  });

  it('should infer PIX key type from key format', () => {
    // Test CPF key
    const cpfCanonical = {
      payment_id: 'PMT-003a',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '55566677788' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };
    expect(canonicalToPixPayload(cpfCanonical).tipoChave).toBe('CPF');

    // Test CNPJ key
    const cnpjCanonical = {
      payment_id: 'PMT-003b',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '12345678901234' },
      alias: { type: 'CNPJ', value: '12345678901234' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };
    expect(canonicalToPixPayload(cnpjCanonical).tipoChave).toBe('CNPJ');

    // Test PHONE key
    const phoneCanonical = {
      payment_id: 'PMT-003c',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '+5511999999999' },
      alias: { type: 'PHONE', value: '+5511999999999' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };
    expect(canonicalToPixPayload(phoneCanonical).tipoChave).toBe('PHONE');

    // Test EMAIL key
    const emailCanonical = {
      payment_id: 'PMT-003d',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: 'user@example.com' },
      alias: { type: 'EMAIL', value: 'user@example.com' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };
    expect(canonicalToPixPayload(emailCanonical).tipoChave).toBe('EMAIL');
  });

  it('should truncate campo livre to 140 chars max', () => {
    const canonical = {
      payment_id: 'PMT-004',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '55566677788' },
      alias: { type: 'CPF', value: '55566677788' },
      remittanceInfo: 'A'.repeat(200),
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.campoLivre).toHaveLength(140);
  });

  it('should strip PIX- prefix from debtor and creditor accounts', () => {
    const canonical = {
      payment_id: 'PMT-005',
      amount: { value: 200, currency: 'BRL' },
      debtor: { account_id: 'PIX-11122233344', name: 'Sender' },
      creditor: { account_id: 'PIX-55566677788', name: 'Receiver' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    // Account numbers should be stripped of PIX- prefix
    expect(result.pagador.contaTransacional.numero).toContain('11122233344');
    expect(result.chave).toBe('55566677788');
  });

  it('should handle missing optional fields gracefully', () => {
    const canonical = {
      payment_id: 'PMT-006',
      amount: { value: 50, currency: 'BRL' },
      debtor: { account_id: 'sender' },
      creditor: { account_id: 'receiver' },
      alias: { type: 'EVP', value: 'receiver' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    // Optional tax ID fields should not be present
    expect(result.pagador.cpf).toBeUndefined();
    expect(result.pagador.cnpj).toBeUndefined();
    expect(result.recebedor.cpf).toBeUndefined();
    expect(result.recebedor.cnpj).toBeUndefined();
    // But names should have defaults
    expect(result.pagador.nome).toBe('Ordenante MIPIT');
    expect(result.recebedor.nome).toBe('Beneficiário MIPIT');
  });

  it('should build identity from taxId when provided', () => {
    const withCpf = {
      payment_id: 'PMT-007a',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344', taxId: '12345678901' },
      creditor: { account_id: '55566677788', taxId: '98765432109876' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(withCpf);

    expect(result.pagador.cpf).toBe('12345678901');
    expect(result.recebedor.cnpj).toBe('98765432109876');
  });

  it('should include additional info when creditor email is present', () => {
    const canonical = {
      payment_id: 'PMT-008',
      amount: { value: 100, currency: 'BRL' },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '55566677788', email: 'recipient@example.com' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    expect(result.infoAdicional).toBeDefined();
    expect(result.infoAdicional![0].nome).toBe('email');
    expect(result.infoAdicional![0].valor).toBe('recipient@example.com');
  });

  it('should handle FX conversion with proper decimal rounding', () => {
    const canonical = {
      payment_id: 'PMT-009',
      amount: { value: 33.33, currency: 'USD' },
      fx: { rate: 5.123 },
      debtor: { account_id: '11122233344' },
      creditor: { account_id: '55566677788' },
      alias: { type: 'CPF', value: '55566677788' },
      origin: { rail: 'PIX' },
      destination: { rail: 'PIX' },
    };

    const result = canonicalToPixPayload(canonical);

    const expected = (Math.round(33.33 * 5.123 * 100) / 100).toFixed(2);
    expect(result.valor.original).toBe(expected);
  });
});

