import type { PixSpiPaymentRequest } from './types.js';
import { PIX_ISPB, generatePixEndToEndId } from './types.js';

interface CanonicalPacs008 {
  payment_id: string;
  amount: { value: number; currency: string };
  fx?: { source_currency?: string; rate?: number };
  debtor: {
    account_id: string;
    name?: string;
    taxId?: string;
    agencia?: string;
    email?: string;
    phone?: string;
  };
  creditor: {
    account_id: string;
    name?: string;
    taxId?: string;
    agencia?: string;
    email?: string;
  };
  alias: { type: string; value: string };
  purpose?: string;
  reference?: string;
  remittanceInfo?: string;
  origin: { rail: string; ispb?: string };
  destination: { rail?: string; ispb?: string };
  trace_id?: string;
}

/**
 * Maps the canonical pacs.008 model to a real PIX SPI payment request.
 * Generates proper EndToEndId per BACEN spec, applies FX conversion,
 * and builds payer/receiver structures with ISPB codes.
 */
export function canonicalToPixPayload(canonical: CanonicalPacs008): PixSpiPaymentRequest {
  const fxRate = canonical.fx?.rate ?? 1;
  const localAmount = canonical.amount.value * fxRate;
  const amountStr = (Math.round(localAmount * 100) / 100).toFixed(2);

  // Strip PIX- prefix from account IDs to get the raw key/account
  const rawChaveOrigem = canonical.debtor.account_id.replace(/^PIX-/, '');
  const rawChaveDestino = (canonical.alias.value || canonical.creditor.account_id).replace(/^PIX-/, '');

  // Infer PIX key type from key format
  const tipoChave = inferPixKeyType(rawChaveDestino);

  // Generate proper SPI EndToEndId: E{ISPB}{YYYYMMDD}{HHmm}{11chars}
  const debtorIspb = (canonical.origin.ispb ?? PIX_ISPB.MIPIT_SIMULATED).padStart(8, '0');
  const endToEndId = generatePixEndToEndId(debtorIspb);

  // Determine creditor ISPB
  const creditorIspb = (canonical.destination.ispb ?? PIX_ISPB.MIPIT_SIMULATED).padStart(8, '0');

  // Build identity (CPF/CNPJ) from taxId
  const pagadorIdentity = buildPixIdentity(canonical.debtor.taxId);
  const recebedorIdentity = buildPixIdentity(canonical.creditor.taxId);

  const request: PixSpiPaymentRequest = {
    endToEndId,
    valor: { original: amountStr },

    pagador: {
      ispb: debtorIspb,
      agencia: canonical.debtor.agencia ?? '0001',
      contaTransacional: {
        numero: extractAccountNumber(rawChaveOrigem),
        tipoConta: 'CACC',
      },
      nome: (canonical.debtor.name ?? 'Ordenante MIPIT').substring(0, 140),
      ...pagadorIdentity,
    },

    recebedor: {
      ispb: creditorIspb,
      agencia: canonical.creditor.agencia,
      // Omit contaTransacional — the DICT resolves it from the chave
      nome: (canonical.creditor.name ?? 'Beneficiário MIPIT').substring(0, 140),
      ...recebedorIdentity,
    },

    chave: rawChaveDestino,
    tipoChave,
    tipo: 'TRANSF',

    // campoLivre visible in bank statement (max 140 chars)
    campoLivre: (canonical.remittanceInfo ?? canonical.reference ?? 'MIPIT-PoC').substring(0, 140),

    // Reconciliation ID from payment_id (strip PMT- prefix, max 35 chars)
    idConciliacao: canonical.payment_id.replace('PMT-', '').substring(0, 35),

    dataHora: new Date().toISOString(),
  };

  // Add additional info if email is present
  if (canonical.creditor.email) {
    request.infoAdicional = [
      { nome: 'email', valor: canonical.creditor.email.substring(0, 200) },
    ];
  }

  return request;
}

/** Infers PIX key type from the raw key string per DICT rules */
function inferPixKeyType(chave: string): PixSpiPaymentRequest['tipoChave'] {
  if (/^\d{11}$/.test(chave)) return 'CPF';
  if (/^\d{14}$/.test(chave)) return 'CNPJ';
  if (/^\+55\d{10,11}$/.test(chave)) return 'PHONE';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) return 'EMAIL';
  return 'EVP'; // Random key or unknown format
}

/** Builds CPF or CNPJ field from a taxId string */
function buildPixIdentity(taxId?: string): { cpf?: string } | { cnpj?: string } {
  if (!taxId) return {};
  const digits = taxId.replace(/\D/g, '');
  if (digits.length === 11) return { cpf: digits };
  if (digits.length === 14) return { cnpj: digits };
  return {};
}

/**
 * Extracts a plausible account number from an alias/key string.
 * For PIX keys that are not account numbers, returns a placeholder
 * (the real ISPB will resolve via DICT lookup).
 */
function extractAccountNumber(raw: string): string {
  // If already looks like an account number (digits with optional dash)
  if (/^\d{5,12}-?\d?$/.test(raw)) return raw;
  // Otherwise use a placeholder — DICT resolves real account
  return '000001-0';
}
