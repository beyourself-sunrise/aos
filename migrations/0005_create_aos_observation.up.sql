-- 0005_create_aos_observation.up.sql
-- Create aos_observation table for Observational Memory v1
-- Requires pgvector extension for vector(1536) + HNSW index

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS aos_observation (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  content         TEXT NOT NULL,
  embedding       vector(1536),
  source_session_id TEXT,
  type            TEXT NOT NULL DEFAULT 'insight' CHECK (type IN ('fact', 'preference', 'pattern', 'insight', 'action')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for cosine distance semantic search
CREATE INDEX IF NOT EXISTS idx_aos_observation_embedding
  ON aos_observation
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for agent-specific lookups
CREATE INDEX IF NOT EXISTS idx_aos_observation_agent_id
  ON aos_observation(agent_id);

-- Index for session-based lookups
CREATE INDEX IF NOT EXISTS idx_aos_observation_session
  ON aos_observation(source_session_id);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_aos_observation_type
  ON aos_observation(type);
