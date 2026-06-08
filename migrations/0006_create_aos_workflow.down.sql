-- 0006_create_aos_workflow.down.sql
-- Drop aos_workflow table and indexes

DROP INDEX IF EXISTS idx_aos_workflow_active;
DROP INDEX IF EXISTS idx_aos_workflow_timeout_waiting;
DROP INDEX IF EXISTS idx_aos_workflow_agent_state;
DROP TABLE IF EXISTS aos_workflow;
