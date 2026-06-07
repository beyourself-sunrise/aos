-- 0004_create_aos_trigger_subscription.down.sql
-- Drop aos_trigger_subscription table

DROP INDEX IF EXISTS idx_aos_trigger_subscription_enabled;
DROP INDEX IF EXISTS idx_aos_trigger_subscription_type;
DROP TABLE IF EXISTS aos_trigger_subscription;
