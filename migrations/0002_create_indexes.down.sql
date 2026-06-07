-- 0002_create_indexes.down.sql
-- Drop performance indexes

DROP INDEX IF EXISTS idx_aos_session_entry_parent_id;
DROP INDEX IF EXISTS idx_aos_session_entry_thread_id;
DROP INDEX IF EXISTS idx_aos_session_updated_at;
DROP INDEX IF EXISTS idx_aos_session_agent_id;
