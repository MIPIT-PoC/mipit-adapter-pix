/**
 * PIX SPI Mock Server
 *
 * NOTE (PoC limitation): The endpoint `POST /spi/v2/pagamentos` is **invented**.
 * The real BCB PIX architecture exposes:
 *   - `/v2/cob{txid}`, `/v2/cobv/{txid}`, `/v2/pix/{e2eid}` (PSP-side, REST +
 *     OAuth2 client_credentials + mTLS with ICP-Brasil certificate).
 *   - SPI itself (Sistema de Pagamentos Instantâneos) is XML messages over
 *     RSFN (Rede do Sistema Financeiro Nacional), not a public REST API.
 *
 * This mock provides a stylized "SPI settlement" REST API for academic interop
 * demonstration. The shapes (field names, EndToEndId format, chave types,
 * BACEN error codes) follow BCB Manual de Padrões para Iniciação do Pix v2.9.0
 * to the extent possible.
 *
 * Implementation details (post P02):
 *   - EndToEndId per BCB format: E + ISPB(8) + YYYYMMDDHHMM(BRT) + 11 alnum.
 *   - PIX is 24/7/365 (BACEN Resolução 1/2020 art. 24); ENFORCE_HOURS=false default.
 *   - Idempotency via in-memory map keyed by EndToEndId.
 *   - Full BACEN code set (AB03, AC01, AM01, AM04, BE01, DS04, MD06, RR01, RR04).
 *   - DICT chave validation: CPF/CNPJ mod-11 checksum (not just regex), phone
 *     +55 E.164, email RFC 5321-light, EVP UUIDv4 with variant/version bits.
 *   - `tipo` enum extended with DEVOL (devolução) and DEPOSIT (PIX Saque/Troco).
 *
 * Known limitations (documented in mipit-docs/LIMITATIONS.md):
 *   - No mTLS (ICP-Brasil cert) — OAuth2 Bearer only.
 *   - No DICT consultation (`GET /v2/dict/{key}`) — chave→account is fake.
 *   - No BR Code (`pixCopiaECola`) — out of SPI settlement scope.
 *   - No devoluções endpoint (`/v2/pix/{e2eid}/devolucao`).
 */

import express from 'express';
import { ulid } from 'ulid';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { PixSpiPaymentRequest, PixSpiPaymentResponse } from './types.js';
import { PIX_ISPB } from './types.js';
import { registerOAuth2Routes, oauthMiddleware } from './oauth-mock.js';
import { registerAdminRoutes, mockConfig, mockStats } from './admin-routes.js';
import { isValidCPF, isValidCNPJ } from './cpf-cnpj-validator.js';

const app = express();
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

// OAuth2 endpoints (must be registered before middleware)
registerOAuth2Routes(app);

// OAuth2 bearer token validation (skips /health, /oauth, /admin)
app.use(oauthMiddleware);

const ENFORCE_HOURS = (process.env.MOCK_ENFORCE_HOURS ?? 'false') === 'true';

/** In-memory idempotency store: endToEndId → settled response */
const processedPayments = new Map<string, PixSpiPaymentResponse>();

// Admin control routes
registerAdminRoutes(app, processedPayments);

/** DICT chave format validators */
const CHAVE_VALIDATORS: Record<string, RegExp> = {
  CPF:   /^\d{11}$/,
  CNPJ:  /^\d{14}$/,
  PHONE: /^\+55\d{10,11}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  EVP:   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

/**
 * P02 — PIX SPI is 24/7/365 by BACEN regulation (Resolução 1/2020 art. 24).
 * Previous implementation enforced M-F + Saturday windows which were copied
 * from the legacy STR (Sistema de Transferência de Reservas) settlement
 * window, not SPI. Returning true always; left ENFORCE_HOURS as a knob for
 * tests that need closed-window simulation.
 */
function isSpiWindowOpen(): boolean {
  return true; // SPI is 24/7/365
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
  // P02 — BCB Manual de Padrões: E + ISPB(8) + YYYYMMDDHHMM(12, BRT) +
  // 11 alphanumeric (case-insensitive per spec) = 32 chars total.
  if (!endToEndId || !/^E\d{8}\d{12}[A-Za-z0-9]{11}$/.test(endToEndId)) {
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

    // P02 — CPF/CNPJ mod-11 checksum (not just regex). DICT rejects bogus IDs.
    if (tipoChave === 'CPF' && !isValidCPF(chave)) {
      const r = buildRejectedResponse(endToEndId, valor.original, 'AC03',
        `CPF '${chave}' falhou validação de dígito verificador (mod-11).`);
      processedPayments.set(endToEndId, r);
      return res.status(200).json(r);
    }
    if (tipoChave === 'CNPJ' && !isValidCNPJ(chave)) {
      const r = buildRejectedResponse(endToEndId, valor.original, 'AC03',
        `CNPJ '${chave}' falhou validação de dígito verificador (mod-11).`);
      processedPayments.set(endToEndId, r);
      return res.status(200).json(r);
    }
  }

  // === Validation: Payment type ===
  // P02 — extended enum to include DEVOL (devolução) per BACEN catalog
  if (tipo && !['TRANSF', 'COBR', 'DBOL', 'DEVOL'].includes(tipo)) {
    return res.status(400).json({
      title: 'Parâmetro inválido.',
      detail: `Tipo de pagamento inválido: ${tipo}. Valores aceitos: TRANSF, COBR, DBOL, DEVOL.`,
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

  // Track stats
  mockStats.totalReceived++;
  mockStats.lastPaymentAt = new Date().toISOString();

  // === Admin: mock disabled (service unavailable) ===
  if (!mockConfig.enabled) {
    return res.status(503).json({
      title: 'Serviço indisponível.',
      detail: 'O SPI está temporariamente indisponível para manutenção.',
    });
  }

  // === Admin: force reject next ===
  if (mockConfig.forceRejectNext) {
    mockConfig.forceRejectNext = false;
    mockStats.totalRejected++;
    const r = buildRejectedResponse(endToEndId, valor.original, mockConfig.forceRejectCode,
      `[ADMIN] Rejeição forçada pelo simulador (código: ${mockConfig.forceRejectCode}).`);
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Admin: force timeout next ===
  if (mockConfig.forceTimeoutNext) {
    mockConfig.forceTimeoutNext = false;
    mockStats.totalTimeout++;
    logger.info({ endToEndId }, 'PIX mock: forcing 30s timeout (admin)');
    setTimeout(() => {
      res.status(504).json({ title: 'Gateway Timeout', detail: 'SPI não respondeu dentro do prazo.' });
    }, 30_000);
    return;
  }

  // === Simulate realistic BACEN SPI rejection scenarios ===
  const failRoll = Math.random();

  if (failRoll < mockConfig.rejectionRate * 0.4) {
    // 4% — Insufficient funds (AM04)
    const r = buildRejectedResponse(endToEndId, valor.original, 'AM04',
      'Saldo insuficiente. O pagador não possui fundos suficientes para realizar a transferência.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < mockConfig.rejectionRate * 0.6) {
    mockStats.totalRejected++;
    const r = buildRejectedResponse(endToEndId, valor.original, 'AC01',
      'Número de conta do recebedor incorreto ou não encontrado no PSP de destino.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < mockConfig.rejectionRate * 0.8) {
    mockStats.totalRejected++;
    const r = buildRejectedResponse(endToEndId, valor.original, 'RR04',
      'Transferência não autorizada por razão regulatória. Limite diário da conta de origem atingido.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < mockConfig.rejectionRate * 0.9) {
    mockStats.totalRejected++;
    const r = buildRejectedResponse(endToEndId, valor.original, 'BE01',
      'Dados do recebedor inconsistentes com a chave PIX registrada no DICT.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }
  if (failRoll < mockConfig.rejectionRate) {
    mockStats.totalRejected++;
    const r = buildRejectedResponse(endToEndId, valor.original, 'DS04',
      'Ordem de pagamento rejeitada pelo PSP do recebedor.');
    processedPayments.set(endToEndId, r);
    return res.status(200).json(r);
  }

  // === Success: simulate SPI settlement latency (configurable) ===
  const latency = mockConfig.minLatencyMs + Math.random() * (mockConfig.maxLatencyMs - mockConfig.minLatencyMs);
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
    mockStats.totalAccepted++;

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
