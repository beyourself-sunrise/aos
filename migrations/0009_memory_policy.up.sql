-- 0009: Memory policy — per-agent, per-type TTL overrides
BEGIN;

CREATE TABLE IF NOT EXISTS aos_memory_policy (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL
    CHECK (type IN ('action','pattern','fact','insight','preference')),
  ttl_days    INTEGER NOT NULL DEFAULT 90,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, type)
);

-- Default TTLs
INSERT INTO aos_memory_policy (id, agent_id, type, ttl_days)
VALUES
  ('default-action', '*', 'action', 90),
  ('default-pattern', '*', 'pattern', 180),
  ('default-fact', '*', 'fact', 180),
  ('default-insight', '*', 'insight', 365),
  ('default-preference', '*', 'preference', 365)
ON CONFLICT (agent_id, type) DO NOTHING;

COMMIT;
