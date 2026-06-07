/**
 * Example: MCP tool call
 *
 * Demonstrates AOS MCP client calling backend tools.
 */

import { SdkMCPClient } from '../adapters/mcp/client/mcp-client';

export async function runMcpToolCallExample(): Promise<void> {
  console.log('[Example] MCP Tool Call Demo');

  const mcp = new SdkMCPClient();
  await mcp.connect(
    process.env.MCP_USER_CORE_URL ?? 'http://user-core-module:8080/mcp/sse',
  );

  const tools = await mcp.listTools();
  console.log('[MCP] Available tools:', tools.map((t) => t.name));

  const result = await mcp.callTool('user-core.find-by-id', {
    userId: 'agent-aos-001',
  });
  console.log('[MCP] Tool result:', result);

  await mcp.disconnect();
  console.log('[Example] MCP Tool Call Demo complete');
}
