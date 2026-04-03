import { initTelemetry } from './observability/otel.js';
const sdk = initTelemetry();

import { connectRabbitMQ } from './messaging/rabbitmq.js';
import { startWorker } from './worker.js';
import { startMockServer } from './pix/mock-server.js';
import { startHealthServer } from './health-server.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

async function main() {
  if (env.PIX_MODE === 'mock') {
    await startMockServer();
    logger.info('PIX mock sandbox started');
  }

  await startHealthServer(env.HEALTH_PORT);

  const { channel } = await connectRabbitMQ(env.RABBITMQ_URL);
  await startWorker(channel);
  logger.info(`mipit-adapter-pix worker started (instance: ${env.INSTANCE_ID})`);

  const shutdown = async () => {
    logger.info('Shutting down adapter-pix...');
    await channel.close();
    await sdk.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start adapter-pix');
  process.exit(1);
});
