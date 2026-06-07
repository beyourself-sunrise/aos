/**
 * AOS — Agent Operating System
 *
 * Entry point for the AOS standalone application.
 * Starts the Fastify HTTP server with dev endpoints and all trigger adapters.
 *
 * Triggers:
 * - CronTrigger: scheduled tasks (croner)
 * - KafkaTrigger: Kafka event consumption (kafkajs)
 * - SlackTrigger: Slack Socket Mode events (@slack/bolt)
 * - ReportTrigger: PG aggregate anomaly detection (cron + pg)
 * - WebhookTrigger: external HTTPS POST with HMAC (fastify)
 */

import { createServer } from './server';
import { CronTrigger } from './adapters/trigger/cron/cron-trigger';
import { KafkaTrigger } from './adapters/trigger/kafka/kafka-trigger';
import { SlackTrigger } from './adapters/trigger/slack/slack-trigger';
import { ReportTrigger } from './adapters/trigger/report/report-trigger';
import { WebhookTrigger } from './adapters/trigger/webhook/webhook-trigger';
import { AuditEventBridge } from './adapters/audit/audit-event-bridge';
import { Client as PgClient } from 'pg';
import type { Trigger, TriggerHandler, TriggerEvent } from './interfaces/trigger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

/**
 * Shared TriggerHandler — all triggers route through this single callback.
 * Logs the event to audit and can be extended to create AOS sessions/tasks.
 */
class SharedTriggerHandler implements TriggerHandler {
  constructor(private audit: AuditEventBridge) {}

  async onTrigger(event: TriggerEvent): Promise<void> {
    const eventType = `aos.trigger.${event.type}.received`;
    console.log(`[TriggerHandler] ${eventType}:`, JSON.stringify(event.payload, null, 2));

    // Log to audit
    await this.audit.log({
      id: crypto.randomUUID(),
      type: eventType,
      actor: 'aos',
      payload: {
        source: event.source,
        eventSummary: this.summarize(event.payload),
        receivedAt: event.timestamp.toISOString(),
      },
      createdAt: event.timestamp,
    });
  }

  private summarize(payload: unknown): string {
    if (typeof payload === 'string') return payload.slice(0, 200);
    if (typeof payload === 'object' && payload !== null) {
      const p = payload as Record<string, unknown>;
      return `${Object.keys(p).join(', ')}: ${JSON.stringify(p).slice(0, 200)}`;
    }
    return String(payload).slice(0, 200);
  }
}

async function main(): Promise<void> {
  console.log('[AOS] Starting Agent Operating System v0.2.0');
  console.log('[AOS] Port:', PORT);

  // Create PG client for audit and report trigger
  const pgClient = new PgClient({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/beyourself',
  });
  await pgClient.connect();

  // Create audit bridge
  const audit = new AuditEventBridge(pgClient);

  // Create shared trigger handler
  const handler = new SharedTriggerHandler(audit);

  // Create server
  const server = await createServer();

  // --- Start all triggers ---
  const triggers: Trigger[] = [];

  // 1. CronTrigger (existing from aos-poc)
  const cronTrigger = new CronTrigger({
    schedule: '0 9 * * *', // Daily at 9:00 AM
    timezone: 'Asia/Taipei',
    payload: { task: 'daily-scan' },
  });
  triggers.push(cronTrigger);

  // 2. KafkaTrigger
  const kafkaTrigger = new KafkaTrigger({
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    groupId: 'aos-trigger-group',
    whitelist: process.env.KAFKA_WHITELIST
      ? process.env.KAFKA_WHITELIST.split(',')
      : ['user-attendance.anomaly-detected', 'cost-collection.expense-submitted', 'sales.order-created'],
  });
  triggers.push(kafkaTrigger);

  // 3. SlackTrigger
  const slackTrigger = new SlackTrigger({
    botToken: process.env.SLACK_BOT_TOKEN ?? 'xoxb-placeholder',
    appToken: process.env.SLACK_APP_TOKEN ?? 'xapp-placeholder',
    botName: 'AOS',
  });
  triggers.push(slackTrigger);

  // 4. ReportTrigger
  const reportTrigger = new ReportTrigger({
    schedule: '0 * * * *', // Every hour
    timezone: 'Asia/Taipei',
    pgClient,
    anomalyThreshold: 2.0,
    queries: [
      {
        name: 'expense-claim-spike',
        query: 'SELECT COUNT(*) as count FROM expense_claim WHERE created_at > NOW() - INTERVAL \'7 days\'',
        baseline: 50,
        threshold: 2.0,
        description: 'Weekly expense claim count vs 30-day baseline',
      },
      {
        name: 'attendance-anomaly',
        query: 'SELECT COUNT(*) as count FROM user_attendance WHERE status = \'absent\' AND created_at > NOW() - INTERVAL \'24 hours\'',
        baseline: 5,
        threshold: 3.0,
        description: '24-hour absence count anomaly',
      },
    ],
  });
  triggers.push(reportTrigger);

  // 5. WebhookTrigger
  const webhookTrigger = new WebhookTrigger({
    path: '/api/aos/webhook',
    method: 'POST',
    sources: [
      { name: 'erpnext', secret: process.env.WEBHOOK_SECRET_ERPNEXT ?? 'erpnext-secret' },
      { name: 'github', secret: process.env.WEBHOOK_SECRET_GITHUB ?? 'github-secret' },
      { name: 'custom', secret: process.env.WEBHOOK_SECRET_CUSTOM ?? 'custom-secret' },
    ],
  });
  triggers.push(webhookTrigger);

  // Start all triggers
  for (const trigger of triggers) {
    await trigger.start(handler);
    console.log(`[AOS] Started trigger: ${trigger.type}`);
  }

  // Start server
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[AOS] Server listening on http://0.0.0.0:${PORT}`);
  console.log('[AOS] Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /dev/trigger-cron');
  console.log('  POST /dev/start-bpmn');
  console.log('  POST /dev/call-mcp');
  console.log('  POST /api/aos/webhook');
  console.log('[AOS] Triggers active: cron, kafka, slack, report, webhook');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[AOS] Shutting down...');
    for (const trigger of triggers) {
      await trigger.stop();
    }
    await server.close();
    await pgClient.end();
    console.log('[AOS] Shutdown complete');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[AOS] Interrupted...');
    for (const trigger of triggers) {
      await trigger.stop();
    }
    await server.close();
    await pgClient.end();
    console.log('[AOS] Shutdown complete');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[AOS] Fatal:', err);
  process.exit(1);
});
