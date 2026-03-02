import type { Channel, ConsumeMessage } from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

export type MessageHandler = (msg: ConsumeMessage) => Promise<void>;

export async function startConsumer(channel: Channel, handler: MessageHandler): Promise<void> {
  await channel.prefetch(1);

  logger.info({ queue: env.QUEUE_NAME }, 'Starting consumer');

  await channel.consume(env.QUEUE_NAME, async (msg) => {
    if (!msg) return;

    try {
      await handler(msg);
      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Message processing failed');
      channel.nack(msg, false, false);
    }
  });
}
