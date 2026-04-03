/**
 * PIX SPI Mock Server
 *
 * Simulates the BACEN SPI sandbox endpoint for PoC testing.
 * Implements proper PIX SPI response format per BACEN specification:
 *   POST /spi/v2/pagamentos → PixSpiPaymentResponse
 *
 * Simulated behaviors:
 *   - 10% random NAO_REALIZADA (insufficient funds, AM04)
 *   - EndToEndId format validation (32 chars, starts with 'E')
 *   - Realistic SPI latency (100–500ms)
 *   - DICT chave validation (minimal, format-based)
 */

import express from 'express';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { PixSpiPaymentRequest, PixSpiPaymentResponse } from './types.js';
import { PIX_ISPB } from './types.js';

const app = express();
app.use(express.json());

/**
 * POST /spi/v2/pagamentos
 * Simulates the BACEN SPI settlement endpoint.
 */
app.post('/spi/v2/pagamentos', (req, res) => {
  const body = req.body as Partial<PixSpiPaymentRequest>;
  const { endToEndId, valor, pagador, recebedor, chave, tipo } = body;

  // === Validation: EndToEndId ===
  if (!endToEndId || !/^E\d{8}\d{8}\d{4}[A-Z0-9]{11}$/.test(endToEndId)) {
    logger.warn({ endToEndId }, 'PIX mock: invalid EndToEndId format');
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: `O campo endToEndId '${endToEndId ?? ''}' não está no formato E{ISPB}{AAAAMMDD}{HHmm}{11chars}.`,
      violacoes: [{ razao: 'Campo fora do padrão esperado.', valor: 'endToEndId' }],
    });
  }

  // === Validation: Amount ===
  if (!valor?.original || !/^\d+\.\d{2}$/.test(valor.original)) {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: 'O campo valor.original deve ser string com exatamente 2 casas decimais.',
      violacoes: [{ razao: 'Formato inválido.', valor: 'valor.original' }],
    });
  }

  const amountValue = parseFloat(valor.original);

  // === Validation: Amount limits (SPI limits BRL 50 mil for natural persons per transaction) ===
  if (amountValue <= 0) {
    return res.status(200).json(buildRejectedResponse(endToEndId, valor.original, 'AM01', 'Valor zero não permitido.'));
  }

  // === Validation: Chave (PIX key format) ===
  if (!chave || chave.trim() === '') {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: 'Campo chave é obrigatório.',
      violacoes: [{ razao: 'Campo obrigatório ausente.', valor: 'chave' }],
    });
  }

  // === Validation: Payment type ===
  if (tipo && !['TRANSF', 'COBR', 'DBOL'].includes(tipo)) {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: `Tipo de pagamento inválido: ${tipo}`,
      violacoes: [{ razao: 'Valor não permitido.', valor: 'tipo' }],
    });
  }

  // === Simulate 10% random failures (BACEN-style rejection codes) ===
  const failRoll = Math.random();
  if (failRoll < 0.05) {
    // 5% - Insufficient funds (AM04)
    return res.status(200).json(buildRejectedResponse(
      endToEndId, valor.original, 'AM04',
      'Saldo insuficiente. O pagador não possui fundos suficientes para realizar a transferência.',
    ));
  }
  if (failRoll < 0.08) {
    // 3% - Regulatory reason (RR04)
    return res.status(200).json(buildRejectedResponse(
      endToEndId, valor.original, 'RR04',
      'Transferência não autorizada por razão regulatória. Limite diário atingido.',
    ));
  }
  if (failRoll < 0.10) {
    // 2% - Order rejected (DS04)
    return res.status(200).json(buildRejectedResponse(
      endToEndId, valor.original, 'DS04',
      'Ordem de pagamento rejeitada pelo PSP do recebedor.',
    ));
  }

  // === Success: simulate SPI settlement latency ===
  const latency = 100 + Math.random() * 400;
  setTimeout(() => {
    const spiTxId = `${ulid().toLowerCase()}`;
    const now = new Date().toISOString();

    const response: PixSpiPaymentResponse = {
      endToEndId,
      id: spiTxId,
      txid: body.idConciliacao,
      valor: valor.original,
      horario: now,
      status: 'CONCLUIDA',
      pagador: {
        ispb: pagador?.ispb ?? PIX_ISPB.MIPIT_SIMULATED,
        agencia: pagador?.agencia,
        contaTransacional: pagador?.contaTransacional,
        nome: pagador?.nome,
        cpf: pagador?.cpf,
        cnpj: pagador?.cnpj,
      },
      recebedor: {
        ispb: recebedor?.ispb ?? PIX_ISPB.MIPIT_SIMULATED,
        agencia: recebedor?.agencia,
        contaTransacional: recebedor?.contaTransacional
          ? recebedor.contaTransacional
          : { numero: '654321-0', tipoConta: 'CACC' }, // DICT-resolved
        nome: recebedor?.nome,
        cpf: recebedor?.cpf,
        cnpj: recebedor?.cnpj,
      },
    };

    logger.info({
      endToEndId,
      status: 'CONCLUIDA',
      valor: valor.original,
      latency_ms: Math.round(latency),
    }, 'PIX mock: transaction settled');

    res.status(201).json(response);
  }, latency);
});

/** Health check endpoint */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pix-mock-spi', version: '2.0', timestamp: new Date().toISOString() });
});

/** Legacy endpoint compatibility (adapter still uses /pix/payments for backward compat) */
app.post('/pix/payments', (req, res) => {
  const { valor, endToEndId } = req.body;
  const amount = typeof valor === 'object' ? valor?.original : String(valor ?? '0.00');

  const shouldFail = Math.random() < 0.1;
  if (shouldFail) {
    return res.status(200).json(buildRejectedResponse(
      endToEndId ?? `E${PIX_ISPB.MIPIT_SIMULATED}${new Date().toISOString().slice(0,10).replace(/-/g,'')}0000LEGACY00001`,
      amount, 'AM04', 'Saldo insuficiente na conta de origem.',
    ));
  }

  const latency = 100 + Math.random() * 400;
  setTimeout(() => {
    const response: PixSpiPaymentResponse = {
      endToEndId: endToEndId ?? `E${PIX_ISPB.MIPIT_SIMULATED}00000000000000000000000`,
      id: ulid().toLowerCase(),
      valor: typeof amount === 'number' ? String(amount) : amount,
      horario: new Date().toISOString(),
      status: 'CONCLUIDA',
      pagador: { ispb: PIX_ISPB.MIPIT_SIMULATED, nome: req.body.nomePagador },
      recebedor: { ispb: PIX_ISPB.MIPIT_SIMULATED, nome: req.body.nomeRecebedor },
    };
    res.status(200).json(response);
  }, latency);
});

function buildRejectedResponse(
  endToEndId: string,
  valor: string,
  codigoErro: string,
  mensagemErro: string,
): PixSpiPaymentResponse {
  return {
    endToEndId,
    id: ulid().toLowerCase(),
    valor,
    horario: new Date().toISOString(),
    status: 'NAO_REALIZADA',
    pagador: { ispb: PIX_ISPB.MIPIT_SIMULATED },
    recebedor: { ispb: PIX_ISPB.MIPIT_SIMULATED },
    motivo: mensagemErro,
    codigoErro,
    mensagemErro,
  };
}

export function startMockServer(port?: number): Promise<import('http').Server> {
  const listenPort = port ?? env.PIX_MOCK_PORT;
  return new Promise((resolve) => {
    const server = app.listen(listenPort, () => {
      logger.info({ port: listenPort }, 'PIX SPI mock sandbox running');
      resolve(server);
    });
  });
}

if (process.argv[1]?.includes('mock-server')) {
  startMockServer();
}
