-- 0007: Add workflow lifecycle columns (checkpoint, parent_id, cancelled)
BEGIN;

ALTER TABLE aos_workflow
  ADD COLUMN IF NOT EXISTS checkpoint     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_id      TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

ALTER TABLE aos_workflow
  ADD CONSTRAINT fk_aos_workflow_parent
    FOREIGN KEY (parent_id) REFERENCES aos_workflow(id)
    ON DELETE SET NULL;

-- Backward-compatible state CHECK constraint upgrade
ALTER TABLE aos_workflow
  DROP CONSTRAINT IF EXISTS aos_workflow_state_check;

ALTER TABLE aos_workflow
  ADD CONSTRAINT aos_workflow_state_check
  CHECK (state IN ('pending','running','waiting','suspended','done','failed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_aos_workflow_parent
  ON aos_workflow(parent_id)
  WHERE parent_id IS NOT NULL;

-- Index for active workflow rehydration (registry on restart)
CREATE INDEX IF NOT EXISTS idx_aos_workflow_active
  ON aos_workflow(agent_id, state)
  WHERE state IN ('running','waiting','suspended');

COMMIT;
