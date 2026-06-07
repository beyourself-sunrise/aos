-- 0001_create_aos_session.up.sql
-- Create aos_session and aos_session_entry tables

-- aos_session: session metadata + optimistic lock
CREATE TABLE IF NOT EXISTS aos_session (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT UNIQUE NOT NULL,
  agent_id      TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  leaf_id       TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- aos_session_entry: immutable entry log (append-only, tree structure via parent_id)
CREATE TABLE IF NOT EXISTS aos_session_entry (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL REFERENCES aos_session(thread_id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES aos_session_entry(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       JSONB NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
