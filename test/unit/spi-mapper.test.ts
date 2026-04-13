import { canonicalToPixPayload } from '../../src/pix/mapper';
import { generatePixEndToEndId, PIX_ISPB } from '../../src/pix/types';

describe('generatePixEndToEndId', () => {
  it('should produce a 32-character ID', () => {
    const id = generatePixEndToEndId('60746948');
    expect(id.length).toBe(32);
  });

  it('should start with E followed by 8-digit ISPB', () => {
    const id = generatePixEndToEndId('60746948');
    expect(id[0]).toBe('E');
    expect(id.substring(1, 9)).toBe('60746948');
  });

  it('should include YYYYMMDD date at positions 9-16', () => {
    const before = new Date();
    const id = generatePixEndToEndId('60746948');
    const dateStr = id.substring(9, 17);
    // Should be 8 digits (YYYYMMDD format)
    expect(/^\d{8}$/.test(dateStr)).toBe(true);
    expect(dateStr.length).toBe(8);
    // Year portion should match current year (first 4 chars)
    const yearStr = dateStr.substring(0, 4);
    expect(parseInt(yearStr)).toBe(before.getFullYear());
  });

  it('should include HHmm at positions 17-20', () => {
    const id = generatePixEndToEndId('60746948');
    const time = id.substring(17, 21);
    expect(/^\d{4}$/.test(time)).toBe(true);
    const hours = parseInt(time.slice(0, 2));
    const mins = parseInt(time.slice(2, 4));
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThanOrEqual(23);
    expect(mins).toBeGreaterThanOrEqual(0);
    expect(mins).toBeLessThanOrEqual(59);
  });

  it('should have 11 uppercase alphanumeric chars at end', () => {
    const id = generatePixEndToEndId('60746948');
    const unique = id.substring(21);
    expect(unique.length).toBe(11);
    expect(/^[A-Z0-9]{11}$/.test(unique)).toBe(true);
  });

  it('should match BACEN EndToEndId regex', () => {
    const id = generatePixEndToEndId();
    // BACEN pattern: E + 8 digit ISPB + 8 digit date + 4 digit time + 11 alphanumeric
    expect(/^E\d{8}\d{8}\d{4}[A-Z0-9]{11}$/.test(id)).toBe(true);
  });

  it('should generate unique IDs on subsequent calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePixEndToEndId('60746948')));
    // With 11 chars of randomness, all should be unique
    expect(ids.size).toBe(100);
  });

  it('should use default ISPB when not provided', () => {
    const id = generatePixEndToEndId();
    // Should use PIX_ISPB.MIPIT_SIMULATED or similar default
    expect(id[0]).toBe('E');
    expect(id.length).toBe(32);
  });
});

describe('canonicalToPixPayload', () => {
  const baseCanonical = {
    payment_id: 'PMT-TEST0001234567890123',
    amount: { value: 1500.00, currency: 'BRL' },
    debtor: {
      account_id: 'PIX-12345678901',  // CPF
      name: 'João Silva',
      taxId: '123.456.789-01',
      agencia: '0001',
    },
    creditor: {
      account_id: 'PIX-maria.garcia@email.com',
      name: 'Maria Garcia',
      taxId: undefined,
    },
    alias: { type: 'PIX_KEY', value: 'maria.garcia@email.com' },
    origin: { rail: 'PIX', ispb: '60746948' },
    destination: { rail: 'PIX', ispb: '00000000' },
    purpose: 'P2P',
    reference: 'REF-001',
  };

  it('should produce a valid PixSpiPaymentRequest', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.endToEndId).toBeDefined();
    expect(result.endToEndId.length).toBe(32);
    expect(result.valor.original).toBe('1500.00');
    expect(result.tipo).toBe('TRANSF');
  });

  it('should format amount with exactly 2 decimal places', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.valor.original).toMatch(/^\d+\.\d{2}$/);
  });

  it('should infer EMAIL key type', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.chave).toBe('maria.garcia@email.com');
    expect(result.tipoChave).toBe('EMAIL');
  });

  it('should infer CPF key type for 11-digit key', () => {
    const canonical = {
      ...baseCanonical,
      alias: { type: 'PIX_KEY', value: '12345678901' },
    };
    const result = canonicalToPixPayload(canonical);
    expect(result.tipoChave).toBe('CPF');
  });

  it('should infer CNPJ key type for 14-digit key', () => {
    const canonical = {
      ...baseCanonical,
      alias: { type: 'PIX_KEY', value: '12345678000199' },
    };
    const result = canonicalToPixPayload(canonical);
    expect(result.tipoChave).toBe('CNPJ');
  });

  it('should infer PHONE key type for +55 phone number', () => {
    const canonical = {
      ...baseCanonical,
      alias: { type: 'PIX_KEY', value: '+5511999887766' },
    };
    const result = canonicalToPixPayload(canonical);
    expect(result.tipoChave).toBe('PHONE');
  });

  it('should infer EVP key type for UUID-like keys', () => {
    const canonical = {
      ...baseCanonical,
      alias: { type: 'PIX_KEY', value: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    };
    const result = canonicalToPixPayload(canonical);
    expect(result.tipoChave).toBe('EVP');
  });

  it('should include CPF from taxId in pagador', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.pagador.cpf).toBe('12345678901');
  });

  it('should set pagador name from debtor', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.pagador.nome).toBe('João Silva');
  });

  it('should set recebedor name from creditor', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.recebedor.nome).toBe('Maria Garcia');
  });

  it('should set ISPB from origin.ispb for pagador', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.pagador.ispb).toBe('60746948');
  });

  it('should apply FX rate to amount when present', () => {
    const canonical = { ...baseCanonical, fx: { rate: 0.95, source_currency: 'USD' } };
    const result = canonicalToPixPayload(canonical);
    const expected = (1500 * 0.95).toFixed(2);
    expect(result.valor.original).toBe(expected);
  });

  it('should set campoLivre from remittanceInfo', () => {
    const canonical = { ...baseCanonical, remittanceInfo: 'Invoice INV-2023-001' };
    const result = canonicalToPixPayload(canonical);
    expect(result.campoLivre).toBe('Invoice INV-2023-001');
  });

  it('should fall back to reference for campoLivre', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.campoLivre).toBe('REF-001');
  });

  it('should set idConciliacao from payment_id without PMT- prefix', () => {
    const result = canonicalToPixPayload(baseCanonical);
    expect(result.idConciliacao).toBe('TEST0001234567890123');
  });

  it('should include email in infoAdicional when creditor email is present', () => {
    const canonical = {
      ...baseCanonical,
      creditor: { ...baseCanonical.creditor, email: 'maria@email.com' },
    };
    const result = canonicalToPixPayload(canonical);
    expect(result.infoAdicional).toBeDefined();
    expect(result.infoAdicional?.[0].nome).toBe('email');
    expect(result.infoAdicional?.[0].valor).toBe('maria@email.com');
  });
});
