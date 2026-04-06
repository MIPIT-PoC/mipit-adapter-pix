# AGENTS.md

<purpose>
This repository implements the PIX rail adapter for MiPIT-PoC: a RabbitMQ worker that consumes canonical payment messages, translates them to PIX-native format, calls the PIX sandbox (or embedded mock), and publishes acknowledgment messages back to the core.

It is responsible for:
- consuming messages from the `payments.route.pix` queue,
- translating CanonicalPacs008 payloads to PIX-native format (valor, chave, tipo_chave, pagador),
- calling the PIX sandbox API with retry and timeout,
- translating PIX responses to PaymentAckMessage (ACCEPTED/REJECTED),
- publishing ACK messages to `mipit.payments` exchange with routing key `ack.pix`,
- running an embedded mock server (port 9001) when PIX_MODE=mock,
- exposing Prometheus metrics and OpenTelemetry traces.

Treat shipped code as the primary source of truth.
When code and documents disagree, prefer:
1. current repo implementation,
2. current architecture/design artifacts in mipit-docs,
3. current SRS,
4. project plan / older planning notes.
</purpose>

<project_scope>
This adapter is a PoC simulation of PIX rail integration.
It does NOT implement:
- real PIX API (Banco Central do Brasil) integration,
- real CPF/CNPJ validation,
- production retry/circuit-breaker patterns,
- real settlement or reconciliation.

The embedded mock server simulates PIX behavior with configurable failure rates and latency.
</project_scope>

<instruction_priority>
- User instructions override default style, tone, and initiative preferences.
- Safety, honesty, privacy, and permission constraints do not yield.
- If a newer user instruction conflicts with an earlier one, follow the newer instruction.
</instruction_priority>

<workflow>
  <phase name="clarify">
  - Before changes, clarify whether the change affects:
    - message consumption (worker.ts),
    - canonical → PIX translation (mapper.ts),
    - PIX → ACK translation (response-mapper.ts),
    - HTTP client / retry logic (client.ts, retry.ts),
    - mock server behavior (mock-server.ts),
    - RabbitMQ connection/topology (messaging/),
    - bootstrap flow (index.ts),
    - observability (otel.ts, logger.ts, metrics.ts).
  - Clarify impact on the ACK message contract with mipit-core.
  </phase>

  <phase name="research">
  - Inspect the current codebase, especially:
    - src/pix/types.ts for PixPaymentRequest and PixPaymentResponse,
    - src/pix/mapper.ts for canonicalToPixPayload,
    - src/pix/response-mapper.ts for pixResponseToAck,
    - src/pix/client.ts for sendPixPayment,
    - src/pix/mock-server.ts for mock behavior,
    - src/worker.ts for the consume → process → publish ACK flow.
  - Cross-reference with mipit-core canonical model and RabbitMQ topology.
  </phase>

  <phase name="plan">
  - Present a plan covering: message format changes, PIX payload changes, ACK format changes, mock behavior changes.
  - Wait for user approval.
  </phase>

  <phase name="implement">
  - Keep the worker flow simple: consume → translate → call → translate response → publish ACK → ack message.
  - Keep mapper functions pure: canonical in → PIX payload out (and vice versa).
  - Keep retry logic generic and configurable via env vars.
  - Keep mock server realistic: random failures, variable latency, proper HTTP status codes.
  - On unrecoverable errors, nack to DLQ (channel.nack with requeue=false).
  </phase>

  <phase name="verify">
  - Run `npm run build` and `npm run lint`.
  - Run unit tests for mapper and response-mapper.
  - Verify mock server responds on port 9001 (POST /pix/payments, GET /health).
  - Verify worker processes a message from the queue and publishes an ACK.
  - Verify DLQ receives messages on repeated failures.
  </phase>

  <phase name="document">
  - Update README.md when PIX payload format, env vars, or behavior changes.
  - Update .env.example when configuration changes.
  </phase>
</workflow>

<architecture_rules>
- This adapter is a standalone RabbitMQ worker, not an HTTP server (except the mock).
- It communicates with mipit-core exclusively through RabbitMQ messages.
- Inbound: CanonicalPacs008 JSON from `payments.route.pix` queue.
- Outbound: PaymentAckMessage JSON to `mipit.payments` exchange with key `ack.pix`.
- The mock server is embedded and starts only when PIX_MODE=mock.
- ADAPTER_ID='adapter-pix', RAIL='PIX' — used in ACK messages for traceability.
</architecture_rules>

<adapter_rules>
- mapper.ts: strip PIX- prefix from alias, apply FX if applicable, map canonical fields to PIX fields.
- response-mapper.ts: map PIX e2e_id → ACCEPTED, error → REJECTED; include latency_ms.
- client.ts: HTTP POST with AbortController timeout, wrapped in withRetry.
- retry.ts: exponential backoff (baseDelay * 2^attempt), configurable maxRetries.
- worker.ts: consume → try { translate → call → ack-translate → publish } catch { nack to DLQ }.
- mock-server.ts: POST /pix/payments returns 200 (90%) or 500 (10%), latency 100-500ms.
</adapter_rules>

<testing_rules>
- Unit test mapper: verify field mapping, prefix stripping, FX calculation.
- Unit test response-mapper: verify ACCEPTED/REJECTED mapping.
- Unit test retry: verify backoff timing and max retries.
- Contract test mock server: verify it returns expected PIX response format.
</testing_rules>

<default_commands>
- Development: `npm run dev`
- Build: `npm run build`
- Start: `npm start`
- Start mock only: `npm run mock`
- Lint: `npm run lint`
- Test: `npm test`
</default_commands>
