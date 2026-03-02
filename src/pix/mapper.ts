import type { PixPaymentRequest } from './types.js';

interface CanonicalPacs008 {
  payment_id: string;
  amount: { value: number; currency: string };
  fx?: { source_currency?: string; rate?: number };
  debtor: { account_id: string; name?: string };
  creditor: { account_id: string; name?: string };
  alias: { type: string; value: string };
  purpose?: string;
  reference?: string;
  origin: { rail: string };
  destination: { rail?: string };
  trace_id?: string;
}

export function canonicalToPixPayload(canonical: CanonicalPacs008): PixPaymentRequest {
  const fxRate = canonical.fx?.rate ?? 1;
  const localAmount = canonical.amount.value * fxRate;

  return {
    pix_tx_ref: canonical.payment_id,
    valor: Math.round(localAmount * 100) / 100,
    moeda: 'BRL',
    chaveOrigem: canonical.debtor.account_id.replace(/^PIX-/, ''),
    chaveDestino: canonical.creditor.account_id.replace(/^PIX-/, ''),
    nomePagador: canonical.debtor.name,
    nomeRecebedor: canonical.creditor.name,
    finalidade: canonical.purpose?.substring(0, 35),
    mensagem: canonical.reference?.substring(0, 140),
    tipoChave: 'PIX_KEY',
    origem: canonical.origin.rail,
    destino: canonical.destination.rail ?? 'PIX',
    trace: canonical.trace_id,
  };
}
