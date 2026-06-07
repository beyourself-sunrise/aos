/**
 * AOS Trigger Interface (SSOT)
 * Multi-source trigger abstraction — cron, Kafka, Slack, webhook, peer AOS.
 * OSS implementations: croner (cron), kafkajs (kafka), @slack/bolt (slack)
 */

export interface Trigger {
  readonly type: TriggerType;
  start(handler: TriggerHandler): Promise<void>;
  stop(): Promise<void>;
}

export type TriggerType = 'cron' | 'kafka' | 'slack' | 'report' | 'webhook';

export interface TriggerHandler {
  onTrigger(event: TriggerEvent): Promise<void>;
}

export interface TriggerEvent {
  type: TriggerType;
  payload: unknown;
  timestamp: Date;
  source?: string;
}

export interface CronTriggerConfig {
  schedule: string;
  timezone?: string;
  payload: unknown;
}

export interface KafkaTriggerConfig {
  brokers: string[];
  topic: string;
  groupId: string;
  payload?: unknown;
}

export interface SlackTriggerConfig {
  botToken: string;
  appToken: string;
  channels: string[];
}

export interface ReportTriggerConfig {
  schedule: string;
  timezone?: string;
  queries: ReportQuery[];
  anomalyThreshold?: number;
}

export interface ReportQuery {
  name: string;
  query: string;
  threshold: number;
  description?: string;
}

export interface WebhookTriggerConfig {
  path: string;
  method?: 'POST' | 'PUT' | 'GET';
  secret?: string;
}
