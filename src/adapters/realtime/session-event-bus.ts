/**
 * SessionEventBus — publishes session events to Kafka.
 *
 * Each session has its own Kafka topic: `aos.session.{threadId}`.
 * This guarantees per-thread message ordering and allows per-session subscription.
 */

import { Kafka, Producer, logLevel } from 'kafkajs';
import type { SessionEvent, SessionEventBus } from '../../interfaces/realtime';

export class KafkaSessionEventBus implements SessionEventBus {
  private producer: Producer;
  private readonly topicPrefix: string;
  private readonly logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };

  constructor(
    kafka: Kafka,
    topicPrefix: string = 'aos.session.',
    logger?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
  ) {
    this.producer = kafka.producer();
    this.topicPrefix = topicPrefix;
    this.logger = logger ?? {
      info: () => {},
      error: () => {},
    };
  }

  async start(): Promise<void> {
    await this.producer.connect();
    this.logger.info('KafkaSessionEventBus producer connected');
  }

  async stop(): Promise<void> {
    await this.producer.disconnect();
    this.logger.info('KafkaSessionEventBus producer disconnected');
  }

  async publish(event: SessionEvent): Promise<void> {
    const topic = `${this.topicPrefix}${event.threadId}`;
    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: event.threadId,
            value: JSON.stringify(event),
          },
        ],
      });
      this.logger.info(`Published event to ${topic}: v${event.version}`);
    } catch (err) {
      this.logger.error(`Failed to publish to ${topic}`, err);
      throw err;
    }
  }
}
