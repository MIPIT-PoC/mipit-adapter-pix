import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development').describe('Application environment'),
  RABBITMQ_URL: z.string().url('RABBITMQ_URL must be a valid AMQP URL').describe('RabbitMQ connection string'),
  QUEUE_NAME: z.string().min(1, 'QUEUE_NAME cannot be empty').default('payments.route.pix').describe('Queue name'),
  ACK_ROUTING_KEY: z.string().min(1, 'ACK_ROUTING_KEY cannot be empty').default('ack.pix').describe('ACK routing key'),
  EXCHANGE_NAME: z.string().min(1, 'EXCHANGE_NAME cannot be empty').default('mipit.payments').describe('Exchange name'),
  PIX_SANDBOX_URL: z.string().url('PIX_SANDBOX_URL must be a valid URL').default('http://localhost:9001').describe('PIX sandbox endpoint'),
  PIX_MODE: z.enum(['sandbox', 'mock']).default('mock').describe('PIX mode'),
  PIX_MOCK_PORT: z.coerce.number().int().positive().default(9001).describe('PIX mock server port'),
  PIX_TIMEOUT_MS: z.coerce.number().int().positive().default(10000).describe('PIX request timeout in milliseconds'),
  PIX_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3).describe('PIX max retry attempts'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL').describe('OpenTelemetry OTLP endpoint'),
  OTEL_SERVICE_NAME: z.string().min(1, 'OTEL_SERVICE_NAME cannot be empty').default('mipit-adapter-pix').describe('OpenTelemetry service name'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info').describe('Logging level'),
  INSTANCE_ID: z.string().default(`pix-${process.pid}`).describe('Instance identifier'),
});

function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n  ');

      console.error('❌ Environment variables validation failed:\n  ' + missingVars);
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
