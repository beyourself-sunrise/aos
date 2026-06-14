-- 0008: Observation v2 — scope, team, lifecycle, consolidation
BEGIN;

ALTER TABLE aos_observation
  ADD COLUMN IF NOT EXISTS origin_agent_id  TEXT,
  ADD COLUMN IF NOT EXISTS scope            TEXT NOT NULL DEFAULT 'agent'
    CHECK (scope IN ('agent','team','global')),
  ADD COLUMN IF NOT EXISTS team_id          TEXT,
  ADD COLUMN IF NOT EXISTS state            TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','consolidated','expired')),
  ADD COLUMN IF NOT EXISTS consolidated_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at       TIMESTAMPTZ;

-- Index for scope-filtered recall
CREATE INDEX IF NOT EXISTS idx_aos_obs_scope
  ON aos_observation(agent_id, scope)
  WHERE scope = 'agent';

-- Index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_aos_obs_ttl
  ON aos_observation(expires_at)
  WHERE state = 'active';

-- Index for consolidation (cosine clustering by agent)
CREATE INDEX IF NOT EXISTS idx_aos_obs_consolidation
  ON aos_observation(agent_id, type)
  WHERE state = 'active';

COMMIT;
