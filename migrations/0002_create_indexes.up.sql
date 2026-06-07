-- 0002_create_indexes.up.sql
-- Create performance indexes for aos_session and aos_session_entry

-- Session lookups by agent
CREATE INDEX IF NOT EXISTS idx_aos_session_agent_id ON aos_session(agent_id);

-- Recent session lookups
CREATE INDEX IF NOT EXISTS idx_aos_session_updated_at ON aos_session(updated_at DESC);

-- Entry lookups by thread + time
CREATE INDEX IF NOT EXISTS idx_aos_session_entry_thread_id ON aos_session_entry(thread_id, created_at);

-- Entry tree traversal
CREATE INDEX IF NOT EXISTS idx_aos_session_entry_parent_id ON aos_session_entry(parent_id);
