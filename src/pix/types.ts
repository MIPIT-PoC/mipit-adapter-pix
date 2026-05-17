/**
 * PIX SPI (Sistema de Pagamentos Instantâneos) Types
 * Based on: BACEN Resolution BCB no 1/2020 and BACEN SPI API specification v2
 *
 * EndToEndId format: E{ISPB_8digits}{YYYYMMDD}{HHmm}{11_unique_chars} = 32 chars
 * Example: E1234567820230601120012345678901
 */

/** PIX key types defined by BACEN/DICT */
export type PixKeyType = 'CPF' | 'CNPJ' | 'PHONE' | 'EMAIL' | 'EVP';

/** Account types (ISO 20022 codes used by PIX) */
export type PixAccountType = 'CACC' | 'SVGS' | 'TRAN' | 'SLRY';

/** PIX payment transaction types */
export type PixTipoTransacao = 'TRANSF' | 'COBR' | 'DBOL';

/** PIX transaction statuses from SPI */
export type PixStatus = 'CONCLUIDA' | 'NAO_REALIZADA' | 'DEVOLVIDA' | 'EM_PROCESSAMENTO';

/**
 * PIX SPI Payment Request
 * Sent to: POST /spi/v2/pagamentos
 */
export interface PixSpiPaymentRequest {
  /**
   * End-to-End ID — unique identifier in the SPI.
   * Format: E + ISPB(8) + AAAAMMDD(8) + HHmm(4) + unique(11) = 32 chars total
   */
  endToEndId: string;

  /** Payment value */
  valor: {
    /** Amount with exactly 2 decimal places as string. e.g. "1500.00" */
    original: string;
  };

  /** Payer (debtor) */
  pagador: {
    /** ISPB of the payer's PSP (8 digits, zero-padded). e.g. "60746948" */
    ispb: string;
    /** Branch number (up to 4 digits) */
    agencia?: string;
    /** Account information */
    contaTransacional: {
      /** Account number with check digit. e.g. "123456-7" */
      numero: string;
      /** CACC=checking, SVGS=savings, TRAN=payment, SLRY=salary */
      tipoConta: PixAccountType;
    };
    /** Full legal name (max 140 chars) */
    nome: string;
    /** CPF (11 digits, no separators) */
    cpf?: string;
    /** CNPJ (14 digits, no separators) */
    cnpj?: string;
  };

  /** Receiver (creditor) */
  recebedor: {
    /** ISPB of the receiver's PSP (8 digits, zero-padded) */
    ispb: string;
    agencia?: string;
    /** May be omitted when routing via PIX key through DICT */
    contaTransacional?: {
      numero: string;
      tipoConta: PixAccountType;
    };
    /** Full legal name (max 140 chars) */
    nome: string;
    cpf?: string;
    cnpj?: string;
  };

  /** PIX alias key (CPF, CNPJ, +5511999999999, email, or EVP UUID) */
  chave: string;

  /** PIX key type for DICT lookup */
  tipoChave?: PixKeyType;

  /** Payment type */
  tipo: PixTipoTransacao;

  /** Free-text payer description visible in bank statement (max 140 chars) */
  campoLivre?: string;

  /**
   * Reconciliation/transaction ID for internal reference.
   * 26–35 alphanumeric chars. Required for COBR (charge) payments.
   */
  idConciliacao?: string;

  /** Additional structured information (max 50 key-value pairs) */
  infoAdicional?: Array<{
    nome: string;   // max 50 chars
    valor: string;  // max 200 chars
  }>;

  /** ISO 8601 timestamp of transaction initiation */
  dataHora?: string;
}

/**
 * PIX SPI Payment Response
 * Returned by the PSP/SPI gateway
 */
export interface PixSpiPaymentResponse {
  /** Same EndToEndId as request */
  endToEndId: string;

  /** SPI internal transaction ID */
  id: string;

  /** DICT transaction ID */
  txid?: string;

  /** Settled amount as string */
  valor: string;

  /** ISO 8601 settlement timestamp */
  horario: string;

  /** SPI processing status */
  status: PixStatus;

  pagador: {
    ispb: string;
    agencia?: string;
    contaTransacional?: { numero: string; tipoConta: PixAccountType };
    nome?: string;
    cpf?: string;
    cnpj?: string;
  };

  recebedor: {
    ispb: string;
    agencia?: string;
    contaTransacional?: { numero: string; tipoConta: PixAccountType };
    nome?: string;
    cpf?: string;
    cnpj?: string;
  };

  /** Error reason in Portuguese (when status = NAO_REALIZADA) */
  motivo?: string;

  /**
   * BACEN SPI error code (when status = NAO_REALIZADA).
   * Reference: BACEN Appendix III — Códigos de rejeição SPI
   *   AB03 - Settlement window closed
   *   AC01 - Incorrect Account Number
   *   AM04 - Insufficient Funds
   *   BE01 - Inconsistent with end customer
   *   DS04 - Order Rejected
   *   MD06 - Refund Request by End Customer
   *   RR01 - Missing Debtor Account Or Identification
   *   RR04 - Regulatory Reason
   */
  codigoErro?: string;

  /** Human-readable error description */
  mensagemErro?: string;
}

/** ISPB codes for major Brazilian PSPs (zero-padded to 8 digits) */
export const PIX_ISPB = {
  BANCO_DO_BRASIL: '00000000',
  BRADESCO:        '60746948',
  ITAU:            '60701190',
  CAIXA:           '00360305',
  SANTANDER:       '90400888',
  NUBANK:          '18236120',
  INTER:           '00416968',
  C6_BANK:         '31872495',
  MIPIT_SIMULATED: '26264220', // Simulated PSP ISPB for PoC
} as const;

/**
 * P02 — Generate a valid PIX EndToEndId per BCB Manual de Padrões para
 * Iniciação do Pix v2.9.0.
 *
 * Format: E + ISPB(8 digits) + YYYYMMDDHHMM (12 chars, Brasília time UTC-3)
 *         + 11 alphanumeric chars = 32 chars total.
 *
 * Notes:
 *   - Timestamp is **Brasília time (UTC-3, no DST since 2019)**, NOT UTC.
 *     The previous implementation used `toISOString().slice(...)` which is
 *     UTC and would emit the wrong date near midnight BRT.
 *   - 11-char suffix uses `crypto.randomBytes` (CSPRNG), not `Math.random`,
 *     to avoid collisions at high throughput.
 */
import { randomBytes } from 'node:crypto';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generatePixEndToEndId(
  ispb: string = PIX_ISPB.MIPIT_SIMULATED,
  now: Date = new Date(),
): string {
  const ispbPadded = ispb.padStart(8, '0');
  if (!/^\d{8}$/.test(ispbPadded)) {
    throw new Error(`Invalid ISPB (must be 8 digits): ${ispb}`);
  }

  // Brasília time = UTC-3, no DST since 2019.
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const yyyy = brt.getUTCFullYear();
  const mm = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(brt.getUTCDate()).padStart(2, '0');
  const hh = String(brt.getUTCHours()).padStart(2, '0');
  const mi = String(brt.getUTCMinutes()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}${hh}${mi}`; // 12 chars

  const bytes = randomBytes(11);
  let suffix = '';
  for (let i = 0; i < 11; i++) suffix += ALNUM[bytes[i] % ALNUM.length];

  const id = `E${ispbPadded}${timestamp}${suffix}`;
  if (id.length !== 32) throw new Error(`EndToEndId length ${id.length} != 32`);
  return id;
}
