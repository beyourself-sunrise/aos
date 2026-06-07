# Triggers 接入指南

## 概述

AOS 支援 5 種觸發源（4 種本 change 新增 + 1 種既有）：

| 觸發源 | 類別 | 實作 | License |
|--------|------|------|---------|
| Cron | `CronTrigger` | `croner` | MIT |
| Kafka | `KafkaTrigger` | `kafkajs` | Apache-2.0 |
| Slack | `SlackTrigger` | `@slack/bolt` | MIT |
| 報表 | `ReportTrigger` | `croner` + `pg` | MIT + PostgreSQL |
| Webhook | `WebhookTrigger` | `fastify` + HMAC | MIT |

所有 trigger 透過 **`TriggerHandler.onTrigger(event)`** 統一 callback 進入 AOS 流程。

## 啟動

所有 trigger 在 `projects/AOS/src/index.ts` bootstrap 中統一啟動：

```ts
const triggers: Trigger[] = [
  cronTrigger,    // Daily 9:00 AM
  kafkaTrigger,   // kafkajs consumer
  slackTrigger,   // @slack/bolt Socket Mode
  reportTrigger,  // cron + PG aggregate
  webhookTrigger, // Fastify HTTP POST
];

for (const trigger of triggers) {
  await trigger.start(handler);
}
```

## 環境變數

| 變數 | 預設值 | 用途 |
|------|--------|------|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker 位址 |
| `KAFKA_WHITELIST` | `user-attendance.anomaly-detected,cost-collection.expense-submitted,sales.order-created` | Kafka 白名單 topic |
| `SLACK_BOT_TOKEN` | `xoxb-placeholder` | Slack Bot Token |
| `SLACK_APP_TOKEN` | `xapp-placeholder` | Slack App Token（Socket Mode） |
| `WEBHOOK_SECRET_ERPNEXT` | `erpnext-secret` | ERPNext webhook HMAC secret |
| `WEBHOOK_SECRET_GITHUB` | `github-secret` | GitHub webhook HMAC secret |
| `WEBHOOK_SECRET_CUSTOM` | `custom-secret` | Custom webhook HMAC secret |

## 個別 Trigger 設定

### KafkaTrigger

- 訂閱 27 個既有 Kafka topic
- 白名單過濾：只有白名單內的 topic 會觸發 handler
- 白名單透過 `KAFKA_WHITELIST` 環境變數設定（逗號分隔）
- 未設定白名單時，預設接受 `user-attendance.anomaly-detected`、`cost-collection.expense-submitted`、`sales.order-created`

### SlackTrigger

- 使用 `@slack/bolt` Socket Mode（不暴露公開 HTTP endpoint）
- 監聽事件：`app_mention`（channel @AOS）、`message.im`（DM 給 AOS）
- 需要 Slack App Token（xapp-...）+ Bot Token（xoxb-...）
- Dev 環境使用 mock events（不接真實 Slack）

### ReportTrigger

- 使用 `croner` 框架定時執行 PG aggregate query
- 內建 2 個報表查詢：
  1. `expense-claim-spike` — 過去 7 天 expense claim 數量
  2. `attendance-anomaly` — 過去 24 小時缺席數量
- 異常閾值：`currentValue > baseline * threshold`
- threshold 預設 2.0（可透過 config 調整）

### WebhookTrigger

- Fastify HTTP POST endpoint（預設 `/api/aos/webhook`）
- HMAC SHA-256 簽名驗證（header `X-AOS-Signature`）
- Multi-source 支援：每個 source 獨立 secret
- 預設 source：`erpnext`、`github`、`custom`
- Accept header `X-AOS-Source` 指定來源（可省略時嘗試所有 secret）
- 最大 payload：1MB

## 白名單設定

白名單目前透過 `KAFKA_WHITELIST` 環境變數設定。未來可擴充至 `aos_trigger_subscription` 表。

## HMAC Secret 管理

Webhook secret 目前透過環境變數傳遞。security-module 的加密工具可擴充為 DB 儲存（`aos_trigger_subscription.secret_encrypted` 欄位）。

## 異常閾值設定

Report trigger 的異常閾值在 `index.ts` bootstrap 中設定：

```ts
{
  name: 'expense-claim-spike',
  baseline: 50,       // 基準值
  threshold: 2.0,     // 當 currentValue > 50 * 2.0 = 100 時觸發
}
```

## 整合 Audit

每種 trigger 收到事件時，透過 `AuditEventBridge` 寫入 `audit_event` 表：

- `aos.trigger.kafka.received`
- `aos.trigger.slack.received`
- `aos.trigger.report.received`
- `aos.trigger.webhook.received`

欄位：`{ source, eventSummary, receivedAt }`

## Database 遷移

```sql
-- 0004_create_aos_trigger_subscription.up.sql
CREATE TABLE IF NOT EXISTS aos_trigger_subscription (
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

## Dev / Sunrise 驗證

### Dev 環境

```bash
# 啟動容器
cd docker && docker compose --profile app up -d

# AOS 會自動啟動所有 trigger（部分 mock 模式）
# Slack: mock events only
# Kafka: 需 Kafka broker 連線
# Webhook: curl -X POST http://localhost:3000/api/aos/webhook \
#   -H 'Content-Type: application/json' \
#   -H 'X-AOS-Signature: <hmac>' \
#   -H 'X-AOS-Source: erpnext' \
#   -d '{"event":"test"}'
```

### Sunrise 環境

正式/類正式環境需設定正確的環境變數：

- `KAFKA_BROKERS`: sunrise.test 或 sunrise.office 的 Kafka 位址（使用外部 IP + port）
- `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`: 正式 Slack App credentials
- `WEBHOOK_SECRET_*`: 各 webhook source 的真實 secret

**跨容器連線注意**：正式環境中，容器視為獨立部署單元。跨服務連線不得依賴 Docker 內部 service name / network alias。需使用外部 IP + port。

## 整合測試

```bash
cd projects/AOS
npm test tests/integration/triggers.integration.test.ts
```

測試涵蓋：
1. KafkaTrigger 白名單 + 非白名單過濾
2. SlackTrigger mock mention
3. ReportTrigger 異常偵測 + 正常值不觸發
4. WebhookTrigger 合法/非法 HMAC
5. 共用 `TriggerHandler.onTrigger` 統一進入
