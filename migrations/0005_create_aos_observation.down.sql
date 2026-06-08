-- 0005_create_aos_observation.down.sql
-- Drop aos_observation table and indexes

DROP INDEX IF EXISTS idx_aos_observation_type;
DROP INDEX IF EXISTS idx_aos_observation_session;
DROP INDEX IF EXISTS idx_aos_observation_agent_id;
DROP INDEX IF EXISTS idx_aos_observation_embedding;
DROP TABLE IF EXISTS aos_observation;
