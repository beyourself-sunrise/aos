-- 0006_create_aos_workflow.up.sql
-- Create aos_workflow table for Workflows v1 state machine
-- Supports: pending -> running -> waiting -> done/failed
-- With optimistic locking (version) and timeout tracking (timeout_at)

CREATE TABLE IF NOT EXISTS aos_workflow (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'waiting', 'done', 'failed')),
  current_step    TEXT,
  context_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_at      TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version         INT NOT NULL DEFAULT 0
);

-- Index for agent + state lookups (e.g., "get all waiting workflows for agent")
CREATE INDEX IF NOT EXISTS idx_aos_workflow_agent_state
  ON aos_workflow(agent_id, state);

-- Index for timeout scanning (find expired waiting workflows)
CREATE INDEX IF NOT EXISTS idx_aos_workflow_timeout_waiting
  ON aos_workflow(timeout_at)
  WHERE state = 'waiting';

-- Index for active workflows (not done/failed)
CREATE INDEX IF NOT EXISTS idx_aos_workflow_active
  ON aos_workflow(state)
  WHERE state NOT IN ('done', 'failed');
