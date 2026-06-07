/**
 * MCP Client — implements AOS MCPClient interface using @modelcontextprotocol/sdk.
 * OSS implementation: @modelcontextprotocol/sdk (MIT)
 */

import type { MCPClient, Tool, ToolResult, ConnectOptions } from '../../../interfaces/mcp';

export class SdkMCPClient implements MCPClient {
  private connected = false;
  private serverUrl: string = '';
  private options?: ConnectOptions;

  async connect(serverUrl: string, options?: ConnectOptions): Promise<void> {
    this.serverUrl = serverUrl;
    this.options = options;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.serverUrl = '';
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) throw new Error('Not connected');
    // POC: return simulated tools
    return [
      { name: 'user-core.find-by-id', description: 'Find user by ID' },
      { name: 'user-core.list', description: 'List users' },
    ];
  }

  async callTool(name: string, args: unknown): Promise<ToolResult> {
    if (!this.connected) throw new Error('Not connected');
    // POC: simulate tool call result
    return {
      content: [
        { type: 'text', data: JSON.stringify({ tool: name, args, result: 'ok' }) },
      ],
    };
  }
}
