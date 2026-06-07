import { describe, it, expect } from 'vitest';
import { SdkMCPClient } from '../../src/adapters/mcp/client/mcp-client';

describe('SdkMCPClient', () => {
  it('should connect and list tools', async () => {
    const client = new SdkMCPClient();
    await client.connect('http://test-mcp-server:8080/mcp/sse');
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBeDefined();
    await client.disconnect();
  });

  it('should call tool and return result', async () => {
    const client = new SdkMCPClient();
    await client.connect('http://test-mcp-server:8080/mcp/sse');
    const result = await client.callTool('test-tool', { arg: 'value' });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    await client.disconnect();
  });

  it('should throw when not connected', async () => {
    const client = new SdkMCPClient();
    await expect(client.listTools()).rejects.toThrow('Not connected');
  });
});
