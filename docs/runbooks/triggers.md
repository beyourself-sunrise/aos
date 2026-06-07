# AOS Triggers Runbook

## Overview

AOS has 5 trigger adapters that implement the `Trigger` interface, all routing through a shared `TriggerHandler.onTrigger(event)` callback:

| Trigger | Adapter | OSS | Purpose |
|---------|---------|-----|---------|
| Cron | `CronTrigger` | `croner` (MIT) | Scheduled tasks |
| Kafka | `KafkaTrigger` | `kafkajs` (Apache-2.0) | Event consumption from 27 topics |
| Slack | `SlackTrigger` | `@slack/bolt` (MIT) | Slack Socket Mode mentions |
| Report | `ReportTrigger` | `croner` + `pg` | PG aggregate anomaly detection |
| Webhook | `WebhookTrigger` | `fastify` + HMAC | External HTTPS POST with HMAC SHA-256 |

## Configuration

### Environment Variables

```bash
# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_WHITELIST=user-attendance.anomaly-detected,cost-collection.expense-submitted,sales.order-created

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# Webhook secrets (one per source)
WEBHOOK_SECRET_ERPNEXT=...
WEBHOOK_SECRET_GITHUB=...
WEBHOOK_SECRET_CUSTOM=...

# Database (for ReportTrigger and audit)
DATABASE_URL=postgresql://localhost:5432/beyourself
```

### Kafka Whitelist

The `KafkaTrigger` subscribes to all 27 existing Kafka topics but only processes events from whitelisted topics. Configure via `KAFKA_WHITELIST` (comma-separated) or the `aos_trigger_subscription` table.

Available topics:
- `user-attendance.clock-in`, `user-attendance.clock-out`, `user-attendance.anomaly-detected`, `user-attendance.absence-recorded`
- `user-payroll.salary-calculated`, `user-payroll.bonus-calculated`, `user-payroll.payroll-finalized`, `user-payroll.dependent-updated`
- `cost-collection.expense-submitted`, `cost-collection.expense-approved`, `cost-collection.expense-rejected`, `cost-collection.cost-category-updated`
- `inventory.stock-adjusted`, `inventory.stock-low`, `inventory.item-created`
- `procurement.purchase-order-created`, `procurement.purchase-order-approved`, `procurement.vendor-updated`
- `manufacturing.work-order-created`, `manufacturing.work-order-completed`
- `sales.order-created`, `sales.order-shipped`, `sales.invoice-generated`
- `hr.employee-onboarded`, `hr.employee-offboarded`, `hr.role-changed`
- `system.audit-event`

### Slack Socket Mode

The `SlackTrigger` uses Socket Mode (no public webhook URL needed). Configure with:
- `SLACK_BOT_TOKEN` — Bot OAuth token (`xoxb-...`)
- `SLACK_APP_TOKEN` — App-level token (`xapp-...`) for Socket Mode

The trigger listens for:
- `app_mention` — `@AOS` mentions in channels
- `message.im` — Direct messages to the AOS bot

### Report Anomaly Thresholds

The `ReportTrigger` runs scheduled aggregate queries and detects anomalies:

```typescript
// Example configuration
{
  schedule: '0 * * * *',  // Every hour
  queries: [
    {
      name: 'expense-claim-spike',
      query: 'SELECT COUNT(*) as count FROM expense_claim WHERE created_at > NOW() - INTERVAL \'7 days\'',
      baseline: 50,
      threshold: 2.0,  // Alert when value > baseline * threshold
      description: 'Weekly expense claim count vs 30-day baseline',
    },
  ],
}
```

An anomaly is detected when: `currentValue > baseline * threshold`

### Webhook HMAC

The `WebhookTrigger` verifies HMAC SHA-256 signatures on incoming POST requests:

1. Each source registers with a unique secret in `aos_trigger_subscription`
2. Sender computes: `HMAC-SHA256(secret, request_body)` → hex string
3. Sender includes signature in `X-AOS-Signature` header
4. Sender identifies source in `X-AOS-Source` header (optional)
5. AOS verifies signature using timing-safe comparison

Example (curl):
```bash
SECRET="your-secret"
BODY='{"event": "test"}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/api/aos/webhook \
  -H "Content-Type: application/json" \
  -H "X-AOS-Signature: $SIGNATURE" \
  -H "X-AOS-Source: erpnext" \
  -d "$BODY"
```

## Database Schema

### `aos_trigger_subscription` Table

```sql
CREATE TABLE aos_trigger_subscription (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type      TEXT NOT NULL CHECK (trigger_type IN ('cron', 'kafka', 'slack', 'report', 'webhook')),
  source_name       TEXT NOT NULL,
  config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_encrypted  TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trigger_type, source_name)
);
```

Migration: `0004_create_aos_trigger_subscription.up.sql`

## Audit Events

Each trigger type emits a distinct audit event:

| Trigger | Event Type | Actor |
|---------|-----------|-------|
| Kafka | `aos.trigger.kafka.received` | `aos` |
| Slack | `aos.trigger.slack.received` | `aos` |
| Report | `aos.trigger.report.received` | `aos` |
| Webhook | `aos.trigger.webhook.received` | `aos` |

Events are written to both `aos_audit` and `audit_event` tables via `AuditEventBridge`.

## Verification

### Dev Environment

```bash
# Start AOS
cd projects/AOS
npm install
npm run dev

# Verify triggers are active
# Check logs for: [AOS] Triggers active: cron, kafka, slack, report, webhook
```

### Integration Tests

```bash
cd projects/AOS
npm run test:integration
# Runs tests/integration/triggers.integration.test.ts
# 6+ test cases covering all 4 trigger types
```

### Production (sunrise.test / sunrise.office)

1. Set environment variables in container config
2. Run migration: `npm run migrate-up`
3. Start AOS container
4. Verify audit events appear in `audit_event` table
5. Test webhook endpoint: `curl -X POST https://<host>/api/aos/webhook`

## Troubleshooting

### KafkaTrigger not receiving events

- Check `KAFKA_BROKERS` is correct
- Verify topic is in whitelist
- Check consumer group ID is unique (`aos-trigger-group`)
- Verify Kafka cluster is accessible

### SlackTrigger not connecting

- Verify `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are valid
- Check Socket Mode is enabled in Slack app settings
- Verify bot is installed in the workspace

### ReportTrigger not detecting anomalies

- Check cron schedule is correct
- Verify PG connection string
- Check query returns expected results
- Verify threshold is appropriate for the data

### WebhookTrigger rejecting requests

- Verify `X-AOS-Signature` header is present
- Check HMAC computation matches (same secret, SHA-256, hex encoding)
- Verify `X-AOS-Source` matches registered source name
- Check request body is valid JSON

## License Compliance

All dependencies are MIT / Apache-2.0 / PostgreSQL License:

| Package | License |
|---------|---------|
| `croner` | MIT |
| `kafkajs` | Apache-2.0 |
| `@slack/bolt` | MIT |
| `fastify` | MIT |
| `pg` | MIT |

Verify with: `npx license-checker --production --csv`
