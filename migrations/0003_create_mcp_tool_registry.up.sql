-- Migration: 0003_create_mcp_tool_registry.up.sql
-- Create the mcp_tool_registry table for storing MCP tool schemas.
-- Each backend module registers its tools here on startup.
-- AOS reads this table to discover available tools.

CREATE TABLE IF NOT EXISTS mcp_tool_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name VARCHAR(255) NOT NULL,
    tool_name VARCHAR(255) NOT NULL,
    schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: latest wins (upsert on module_name, tool_name)
    CONSTRAINT uq_mcp_tool_registry_module_tool UNIQUE (module_name, tool_name)
);

-- Index for fast lookup by module
CREATE INDEX IF NOT EXISTS idx_mcp_tool_registry_module ON mcp_tool_registry (module_name);

-- Index for fast lookup by tool name across modules
CREATE INDEX IF NOT EXISTS idx_mcp_tool_registry_tool_name ON mcp_tool_registry (tool_name);

-- Comment for documentation
COMMENT ON TABLE mcp_tool_registry IS 'MCP tool registry — stores tool schemas from all 26 backend modules. AOS reads this on boot with 5-min refresh.';
COMMENT ON COLUMN mcp_tool_registry.module_name IS 'Backend module name (e.g. user-attendance, cost-collection)';
COMMENT ON COLUMN mcp_tool_registry.tool_name IS 'Tool action name (e.g. findUserById, getMonthlyCost)';
COMMENT ON COLUMN mcp_tool_registry.schema_json IS 'MCP tool schema in JSON format (description, inputSchema, etc.)';
COMMENT ON COLUMN mcp_tool_registry.version IS 'Schema version (latest wins semantics)';
COMMENT ON COLUMN mcp_tool_registry.updated_at IS 'Last updated timestamp';
