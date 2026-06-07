-- 0004_create_aos_trigger_subscription.up.sql
-- Create aos_trigger_subscription table for multi-source trigger configuration

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

-- Index for fast lookup by trigger type
CREATE INDEX IF NOT EXISTS idx_aos_trigger_subscription_type ON aos_trigger_subscription(trigger_type);

-- Index for enabled subscriptions
CREATE INDEX IF NOT EXISTS idx_aos_trigger_subscription_enabled ON aos_trigger_subscription(enabled);
