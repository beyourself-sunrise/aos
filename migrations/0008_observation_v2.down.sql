-- 0008 down: remove observation v2 columns
BEGIN;

ALTER TABLE aos_observation
  DROP COLUMN IF EXISTS origin_agent_id,
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS team_id,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS consolidated_count,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS expired_at;

DROP INDEX IF EXISTS idx_aos_obs_scope;
DROP INDEX IF EXISTS idx_aos_obs_ttl;
DROP INDEX IF EXISTS idx_aos_obs_consolidation;

COMMIT;
