export interface PixPaymentRequest {
  pix_tx_ref: string;
  valor: number;
  moeda: string;
  chaveOrigem: string;
  chaveDestino: string;
  nomePagador?: string;
  nomeRecebedor?: string;
  finalidade?: string;
  mensagem?: string;
  timestamp?: string;
  tipoChave: string;
  origem: string;
  destino: string;
  trace?: string;
}

export interface PixPaymentResponse {
  pix_tx_id: string;
  status: 'ACCEPTED' | 'REJECTED';
  valor: number;
  moeda: string;
  timestamp: string;
  erro_codigo?: string;
  erro_mensagem?: string;
}
