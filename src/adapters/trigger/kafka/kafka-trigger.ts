/**
 * Kafka Trigger — implements AOS Trigger interface using kafkajs.
 * OSS implementation: kafkajs (Apache-2.0)
 *
 * Subscribes to existing 27 Kafka event topics and filters by whitelist.
 * Only events matching the whitelist (from aos_trigger_subscription config)
 * are forwarded to the TriggerHandler.
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import type { Trigger, TriggerHandler, TriggerEvent, KafkaTriggerConfig } from '../../../interfaces/trigger';

// All 27 existing Kafka event topics from common-module schema registry
const ALL_KAFKA_TOPICS: string[] = [
  'user-attendance.clock-in',
  'user-attendance.clock-out',
  'user-attendance.anomaly-detected',
  'user-attendance.absence-recorded',
  'user-payroll.salary-calculated',
  'user-payroll.bonus-calculated',
  'user-payroll.payroll-finalized',
  'user-payroll.dependent-updated',
  'cost-collection.expense-submitted',
  'cost-collection.expense-approved',
  'cost-collection.expense-rejected',
  'cost-collection.cost-category-updated',
  'inventory.stock-adjusted',
  'inventory.stock-low',
  'inventory.item-created',
  'procurement.purchase-order-created',
  'procurement.purchase-order-approved',
  'procurement.vendor-updated',
  'manufacturing.work-order-created',
  'manufacturing.work-order-completed',
  'sales.order-created',
  'sales.order-shipped',
  'sales.invoice-generated',
  'hr.employee-onboarded',
  'hr.employee-offboarded',
  'hr.role-changed',
  'system.audit-event',
];

export interface KafkaTriggerOptions {
  /** Kafka broker addresses */
  brokers: string[];
  /** Consumer group ID */
  groupId: string;
  /** Topics to whitelist (subset of ALL_KAFKA_TOPICS). Empty = all topics. */
  whitelist?: string[];
  /** Client ID for Kafka */
  clientId?: string;
}

export class KafkaTrigger implements Trigger {
  readonly type = 'kafka' as const;

  private kafka: Kafka;
  private consumer: Consumer | null = null;
  private handler: TriggerHandler | null = null;
  private whitelist: Set<string>;
  private running = false;

  constructor(private config: KafkaTriggerOptions) {
    this.kafka = new Kafka({
      clientId: config.clientId ?? 'aos-kafka-trigger',
      brokers: config.brokers,
    });
    this.whitelist = new Set(config.whitelist ?? ALL_KAFKA_TOPICS);
  }

  async start(handler: TriggerHandler): Promise<void> {
    if (this.running) {
      return;
    }
    this.handler = handler;
    this.running = true;

    this.consumer = this.kafka.consumer({ groupId: this.config.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: ALL_KAFKA_TOPICS,
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: this.onMessage.bind(this),
    });

    console.log(`[KafkaTrigger] Started, subscribed to ${ALL_KAFKA_TOPICS.length} topics, whitelist: ${this.whitelist.size}`);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.consumer) {
      return;
    }
    this.running = false;
    await this.consumer.stop();
    await this.consumer.disconnect();
    this.consumer = null;
    console.log('[KafkaTrigger] Stopped');
  }

  private async onMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!this.handler || !this.running) {
      return;
    }

    // Whitelist filter — only process whitelisted topics
    if (!this.whitelist.has(topic)) {
      console.log(`[KafkaTrigger] Filtered non-whitelist topic: ${topic}`);
      return;
    }

    const payload = message.value?.toString() ?? '';
    const event: TriggerEvent = {
      type: 'kafka',
      payload: {
        topic,
        key: message.key?.toString() ?? null,
        data: this.parsePayload(payload),
      },
      timestamp: new Date(),
      source: topic,
    };

    try {
      await this.handler.onTrigger(event);
    } catch (err) {
      console.error(`[KafkaTrigger] Handler error for ${topic}:`, err);
    }
  }

  private parsePayload(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /** Get the list of all known Kafka topics */
  static getAllTopics(): string[] {
    return [...ALL_KAFKA_TOPICS];
  }
}
