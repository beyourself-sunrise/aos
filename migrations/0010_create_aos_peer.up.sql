-- 0010: AOS peer table for multi-AOS networking
BEGIN;

CREATE TABLE IF NOT EXISTS aos_peer (
  peer_id          TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL,
  host             TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state            TEXT NOT NULL DEFAULT 'healthy'
                   CHECK (state IN ('healthy','unhealthy','offline')),
  capabilities     JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_aos_peer_state
  ON aos_peer(state);

CREATE INDEX IF NOT EXISTS idx_aos_peer_agent
  ON aos_peer(agent_id);

COMMIT;
