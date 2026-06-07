/**
 * RealTimeStreamService — consumes Kafka events and emits them via socket.io.
 *
 * Subscribes to all `aos.session.*` topics and forwards events to the
 * appropriate socket.io rooms based on the SubscriptionRegistry.
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { SessionEvent } from '../../interfaces/realtime';
import type { SubscriptionRegistryInterface } from '../../interfaces/realtime';

export class RealTimeStreamService {
  private consumer: Consumer;
  private readonly topicPrefix: string;
  private readonly logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };

  constructor(
    private io: SocketIOServer,
    kafka: Kafka,
    private registry: SubscriptionRegistryInterface,
    topicPrefix: string = 'aos.session.',
    logger?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
  ) {
    this.consumer = kafka.consumer({ groupId: 'aos-realtime-stream' });
    this.topicPrefix = topicPrefix;
    this.logger = logger ?? {
      info: () => {},
      error: () => {},
    };
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    // Subscribe to all session topics using regex
    await this.consumer.subscribe({ topic: /^aos\.session\..*/, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        try {
          const threadId = topic.replace(this.topicPrefix, '');
          const value = message.value;
          if (!value) return;

          const event: SessionEvent = JSON.parse(value.toString());

          // Emit to all subscribers of this thread
          const subscribers = this.registry.getSubscribers(threadId);
          let emitted = 0;
          for (const connectionId of subscribers) {
            this.io.to(connectionId).emit('session_event', event);
            emitted++;
          }

          if (emitted > 0) {
            this.logger.info(`Emitted event to ${emitted} subscribers for ${threadId}: v${event.version}`);
          }
        } catch (err) {
          this.logger.error('Failed to process Kafka message', err);
        }
      },
    });

    this.logger.info('RealTimeStreamService consumer started');
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
    this.logger.info('RealTimeStreamService consumer stopped');
  }
}
