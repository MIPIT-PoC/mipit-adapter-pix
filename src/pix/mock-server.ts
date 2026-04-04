/**
 * PIX SPI Mock Server
 *
 * Simulates the BACEN SPI sandbox endpoint for PoC testing.
 * Implements proper PIX SPI response format per BACEN specification:
 *   POST /spi/v2/pagamentos → PixSpiPaymentResponse
 *
 * Simulated behaviors per BACEN SPI spec (BCB Resolution no 1/2020):
 *   - EndToEndId deduplication (returns same response on duplicate)
 *   - Full BACEN SPI error code set (AB03, AC01, AM01, AM04, BE01, DS04, MD06, RR01, RR04)
 *   - PIX key (chave) format validation per DICT spec:
 *       CPF:   \d{11}
 *       CNPJ:  \d{14}
 *       PHONE: \+55\d{10,11}
 *       EMAIL: RFC 5321
 *       EVP:   UUID v4
 *   - SPI operating hours: M–F 07:00–23:59 BRT, Sat 07:00–18:00 BRT (AB03 outside)
 *   - PIX Noturno limit: BRL 1,000 between 20:00–06:59 (AM04)
 *   - Amount: 2-decimal string, > 0, max BRL 999,999,999.99
 *   - Realistic SPI latency (80–450ms)
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
 * PoC mode: when MOCK_ENFORCE_HOURS=false (default in PoC), operating window
 * and nocturnal limit checks are bypassed so tests are deterministic regardless
 * of the time of day. Set MOCK_ENFORCE_HOURS=true to simulate real BACEN SPI
 * operating constraints.
 */
const ENFORCE_HOURS = (process.env.MOCK_ENFORCE_HOURS ?? 'false') === 'true';

/** In-memory idempotency store: endToEndId → settled response */
const processedPayments = new Map<string, PixSpiPaymentResponse>();

/** DICT chave format validators */
const CHAVE_VALIDATORS: Record<string, RegExp> = {
  CPF:   /^\d{11}$/,
  CNPJ:  /^\d{14}$/,
  PHONE: /^\+55\d{10,11}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  EVP:   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

/**
 * Returns true if the current BRT time is inside BACEN SPI operating window.
 * SPI window (BRT = UTC-3):
 *   Monday–Friday: 07:00–23:59
 *   Saturday:      07:00–17:59
 *   Sunday:        closed
 */
function isSpiWindowOpen(): boolean {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000); // UTC-3
  const day  = brt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = brt.getUTCHours();
  const min  = brt.getUTCMinutes();
  const hhmm = hour * 100 + min;

  if (day === 0) return false;            // Sunday: closed
  if (day === 6) return hhmm >= 700 && hhmm <= 1759; // Saturday
  return hhmm >= 700;                     // Mon–Fri: 07:00–23:59
}

/**
 * Returns true if the PIX Noturno restriction applies.
 * BACEN restricts transactions between 20:00–06:59 BRT to BRL 1,000 for natural persons.
 */
function isPixNocturnalWindow(): boolean {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hour = brt.getUTCHours();
  return hour >= 20 || hour < 7;
}

/**
 * POST /spi/v2/pagamentos
 * Simulates the BACEN SPI settlement endpoint.
 */
app.post('/spi/v2/pagamentos', (req, res) => {
  const body = req.body as Partial<PixSpiPaymentRequest>;
  const { endToEndId, valor, pagador, recebedor, chave, tipoChave, tipo } = body;

  // === Idempotency: return cached response for duplicate endToEndId ===
  if (endToEndId && processedPayments.has(endToEndId)) {
    logger.info({ endToEndId }, 'PIX mock: duplicate endToEndId — returning cached response');
    return res.status(200).json(processedPayments.get(endToEndId));
  }

  // === Validation: EndToEndId format ===
  // Format: E + ISPB(8) + YYYYMMDD(8) + HHmm(4) + 11 unique chars = 32 chars total
  if (!endToEndId || !/^E\d{8}\d{8}\d{4}[A-Z0-9]{11}$/.test(endToEndId)) {
    logger.warn({ endToEndId }, 'PIX mock: invalid EndToEndId format');
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: `O campo endToEndId '${endToEndId ?? ''}' não está no formato E{ISPB}{AAAAMMDD}{HHmm}{11chars}.`,
      violacoes: [{ razao: 'Campo fora do padrão esperado.', valor: 'endToEndId' }],
    });
  }

  // === Validation: Amount format ===
  if (!valor?.original || !/^\d+\.\d{2}$/.test(valor.original)) {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: 'O campo valor.original deve ser string com exatamente 2 casas decimais (ex: "100.00").',
      violacoes: [{ razao: 'Formato inválido.', valor: 'valor.original' }],
    });
  }

  const amountValue = parseFloat(valor.original);

  // === Validation: Amount zero ===
  if (amountValue <= 0) {
    const r = buildRejectedResponse(endToEndId, valor.original, 'AM01', 'Valor zero não permitido pelo SPI.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Validation: Amount maximum ===
  if (amountValue > 999_999_999.99) {
    const r = buildRejectedResponse(endToEndId, valor.original, 'AM02', 'Valor excede o limite máximo permitido pelo SPI.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Validation: Chave required ===
  if (!chave || chave.trim() === '') {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: 'Campo chave é obrigatório.',
      violacoes: [{ razao: 'Campo obrigatório ausente.', valor: 'chave' }],
    });
  }

  // === Validation: Chave format (DICT) ===
  if (tipoChave && CHAVE_VALIDATORS[tipoChave]) {
    if (!CHAVE_VALIDATORS[tipoChave].test(chave)) {
      const r = buildRejectedResponse(endToEndId, valor.original, 'AC03',
        `Chave '${chave}' não corresponde ao formato esperado para tipoChave '${tipoChave}'.`);
      processedPayments.set(endToEndId, r);
      return res.status(200).json(r);
    }
  }

  // === Validation: Payment type ===
  if (tipo && !['TRANSF', 'COBR', 'DBOL'].includes(tipo)) {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: `Tipo de pagamento inválido: ${tipo}. Valores aceitos: TRANSF, COBR, DBOL.`,
      violacoes: [{ razao: 'Valor não permitido.', valor: 'tipo' }],
    });
  }

  // === Validation: SPI operating window (AB03) ===
  if (ENFORCE_HOURS && !isSpiWindowOpen()) {
    const r = buildRejectedResponse(endToEndId, valor.original, 'AB03',
      'Janela de liquidação do SPI fechada. O SPI opera de segunda a sexta das 07:00 às 23:59 BRT e sábados das 07:00 às 18:00 BRT.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Validation: PIX Noturno limit (BRL 1,000) ===
  if (ENFORCE_HOURS && isPixNocturnalWindow() && amountValue > 1_000) {
    const r = buildRejectedResponse(endToEndId, valor.original, 'AM04',
      `Valor R$ ${amountValue.toFixed(2)} excede o limite noturno do PIX (R$ 1.000,00) entre 20:00–06:59 BRT.`);
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Simulate realistic BACEN SPI rejection scenarios ===
  const failRoll = Math.random();

  if (failRoll < 0.04) {
    // 4% — Insufficient funds (AM04)
    const r = buildRejectedResponse(endToEndId, valor.original, 'AM04',
      'Saldo insuficiente. O pagador não possui fundos suficientes para realizar a transferência.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < 0.06) {
    // 2% — Incorrect account number (AC01)
    const r = buildRejectedResponse(endToEndId, valor.original, 'AC01',
      'Número de conta do recebedor incorreto ou não encontrado no PSP de destino.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < 0.08) {
    // 2% — Regulatory reason (RR04)
    const r = buildRejectedResponse(endToEndId, valor.original, 'RR04',
      'Transferência não autorizada por razão regulatória. Limite diário da conta de origem atingido.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < 0.09) {
    // 1% — Inconsistent with end customer (BE01)
    const r = buildRejectedResponse(endToEndId, valor.original, 'BE01',
      'Dados do recebedor inconsistentes com a chave PIX registrada no DICT.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < 0.10) {
    // 1% — Order rejected by receiving PSP (DS04)
    const r = buildRejectedResponse(endToEndId, valor.original, 'DS04',
      'Ordem de pagamento rejeitada pelo PSP do recebedor.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Success: simulate SPI settlement latency (80–450ms) ===
  const latency = 80 + Math.random() * 370;
  setTimeout(() => {
    const spiTxId = ulid().toLowerCase();
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
          ?? { numero: '654321-0', tipoConta: 'CACC' }, // DICT-resolved default
        nome: recebedor?.nome,
        cpf: recebedor?.cpf,
        cnpj: recebedor?.cnpj,
      },
    };

    processedPayments.set(endToEndId, response);

    logger.info({
      endToEndId,
      spiTxId,
      status: 'CONCLUIDA',
      valor: valor.original,
      latency_ms: Math.round(latency),
    }, 'PIX mock: transaction settled (CONCLUIDA)');

    res.status(201).json(response);
  }, latency);
});

/** GET /spi/v2/pagamentos/:endToEndId — query payment status */
app.get('/spi/v2/pagamentos/:endToEndId', (req, res) => {
  const { endToEndId } = req.params;
  const payment = processedPayments.get(endToEndId);
  if (!payment) {
    return res.status(404).json({
      title: 'Pagamento não encontrado.',
      detail: `EndToEndId '${endToEndId}' não localizado no SPI.`,
    });
  }
  res.status(200).json(payment);
});

/** Health check endpoint */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pix-mock-spi',
    version: '2.0',
    spiWindowOpen: isSpiWindowOpen(),
    pixNocturnalActive: isPixNocturnalWindow(),
    processedCount: processedPayments.size,
    timestamp: new Date().toISOString(),
  });
});

/** Legacy endpoint compatibility */
app.post('/pix/payments', (req, res) => {
  const { valor, endToEndId } = req.body;
  const amount = typeof valor === 'object' ? valor?.original : String(valor ?? '0.00');

  const shouldFail = Math.random() < 0.1;
  if (shouldFail) {
    return res.status(200).json(buildRejectedResponse(
      endToEndId ?? `E${PIX_ISPB.MIPIT_SIMULATED}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}0000LEGACY00001`,
      amount, 'AM04', 'Saldo insuficiente na conta de origem.',
    ));
  }

  const latency = 80 + Math.random() * 370;
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
      logger.info({ port: listenPort }, 'PIX SPI mock sandbox running (BACEN SPI v2)');
      resolve(server);
    });
  });
}

if (process.argv[1]?.includes('mock-server')) {
  startMockServer();
}
