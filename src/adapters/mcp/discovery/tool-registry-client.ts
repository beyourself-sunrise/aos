/**
 * Tool Registry Client — loads MCP tool schemas from the mcp_tool_registry PG table.
 *
 * On AOS boot, fetches all tool schemas and caches them in memory.
 * Refreshes every 5 minutes to pick up new tools from newly MCP-ized modules.
 *
 * Provides:
 * - getTool(module, name) — get a specific tool schema
 * - listTools(module?) — list all tools, optionally filtered by module
 * - refresh() — force a refresh from the database
 */

import { Client as PgClient } from 'pg';
import type { Tool } from '../../../interfaces/mcp';

export interface ToolRegistryEntry {
  id: string;
  moduleName: string;
  toolName: string;
  schemaJson: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}

export class ToolRegistryClient {
  private pgClient: PgClient;
  private tools: Map<string, Tool> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly refreshMs: number;
  private loaded = false;

  constructor(
    pgClient: PgClient,
    refreshMinutes: number = 5,
  ) {
    this.pgClient = pgClient;
    this.refreshMs = refreshMinutes * 60 * 1000;
  }

  /**
   * Initialize the tool registry — load all tools from PG.
   */
  async initialize(): Promise<void> {
    console.log('[ToolRegistry] Loading tool schemas from mcp_tool_registry...');
    await this.loadTools();
    this.startRefreshInterval();
    this.loaded = true;
    console.log(`[ToolRegistry] Loaded ${this.tools.size} tool schemas`);
  }

  /**
   * Get a specific tool schema by module and name.
   */
  getTool(module: string, name: string): Tool | undefined {
    return this.tools.get(`${module}.${name}`);
  }

  /**
   * List all tool schemas, optionally filtered by module.
   */
  listTools(module?: string): Tool[] {
    if (module) {
      return Array.from(this.tools.values()).filter(
        (t) => t.name.startsWith(`${module}.`)
      );
    }
    return Array.from(this.tools.values());
  }

  /**
   * Get the count of loaded tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Check if the registry has been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Force a refresh from the database.
   */
  async refresh(): Promise<void> {
    console.log('[ToolRegistry] Refreshing tool schemas...');
    await this.loadTools();
    console.log(`[ToolRegistry] Refreshed to ${this.tools.size} tool schemas`);
  }

  /**
   * Shutdown — stop the refresh interval.
   */
  async shutdown(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async loadTools(): Promise<void> {
    try {
      const result = await this.pgClient.query(
        'SELECT id, module_name, tool_name, schema_json, version, updated_at FROM mcp_tool_registry ORDER BY module_name, tool_name'
      );

      const newTools = new Map<string, Tool>();
      for (const row of result.rows) {
        const schema = row.schema_json as Record<string, unknown>;
        const fullName = `${row.module_name}.${row.tool_name}`;
        newTools.set(fullName, {
          name: fullName,
          description: (schema.description as string) ?? `${row.module_name}.${row.tool_name}`,
          inputSchema: schema.inputSchema as Record<string, unknown> | undefined,
        });
      }

      this.tools = newTools;
    } catch (err) {
      console.error('[ToolRegistry] Failed to load tools:', err);
      // Keep existing tools on error
    }
  }

  private startRefreshInterval(): void {
    this.refreshInterval = setInterval(async () => {
      try {
        await this.loadTools();
      } catch (err) {
        console.error('[ToolRegistry] Refresh failed:', err);
      }
    }, this.refreshMs);
  }
}
