-- 0007 down: Remove workflow lifecycle columns (suspend/cancel/parent)
BEGIN;

ALTER TABLE aos_workflow
  DROP CONSTRAINT IF EXISTS fk_aos_workflow_parent;

ALTER TABLE aos_workflow
  DROP COLUMN IF EXISTS checkpoint,
  DROP COLUMN IF EXISTS parent_id,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancel_reason;

-- Restore original CHECK constraint
ALTER TABLE aos_workflow
  DROP CONSTRAINT IF EXISTS aos_workflow_state_check;

ALTER TABLE aos_workflow
  ADD CONSTRAINT aos_workflow_state_check
  CHECK (state IN ('pending','running','waiting','done','failed'));

DROP INDEX IF EXISTS idx_aos_workflow_parent;
DROP INDEX IF EXISTS idx_aos_workflow_active;

COMMIT;
