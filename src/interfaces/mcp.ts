/**
 * AOS MCP Interface (SSOT)
 * Model Context Protocol client abstraction.
 * OSS implementation: @modelcontextprotocol/sdk (MIT)
 */

export interface MCPClient {
  connect(serverUrl: string, options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
}

export interface ConnectOptions {
  timeout?: number;
  headers?: Record<string, string>;
  transport?: 'sse' | 'stdio' | 'http';
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

export interface ToolResultContent {
  type: 'text' | 'image' | 'resource';
  data: unknown;
}
