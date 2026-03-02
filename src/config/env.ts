import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RABBITMQ_URL: z.string(),
  QUEUE_NAME: z.string().default('payments.route.pix'),
  ACK_ROUTING_KEY: z.string().default('ack.pix'),
  EXCHANGE_NAME: z.string().default('mipit.payments'),
  PIX_SANDBOX_URL: z.string().url().default('http://localhost:9001'),
  PIX_MODE: z.enum(['sandbox', 'mock']).default('mock'),
  PIX_MOCK_PORT: z.coerce.number().default(9001),
  PIX_TIMEOUT_MS: z.coerce.number().default(10000),
  PIX_MAX_RETRIES: z.coerce.number().default(3),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('mipit-adapter-pix'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  INSTANCE_ID: z.string().default(`pix-${process.pid}`),
});

export const env = envSchema.parse(process.env);
