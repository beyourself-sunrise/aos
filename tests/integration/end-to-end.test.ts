import { describe, it, expect } from 'vitest';
import { CronTrigger } from '../../src/adapters/trigger/cron/cron-trigger';
import { PiAgentAdapter } from '../../src/adapters/agent/pi-agent-adapter';
import { SdkMCPClient } from '../../src/adapters/mcp/client/mcp-client';
import type { Session, SessionContext, SessionEntry } from '../../src/interfaces/agent';
import type { Audit, AuditEvent, AuditFilter } from '../../src/interfaces/audit';

class MockSession implements Session {
  readonly threadId = 'test-e2e';
  private entries: SessionEntry[] = [];
  async getContext(): Promise<SessionContext> {
    return { history: this.entries, metadata: {} };
  }
  async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class MockAudit implements Audit {
  events: AuditEvent[] = [];
  async log(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(): Promise<AuditEvent[]> { return this.events; }
}

describe('End-to-End Integration', () => {
  it('should complete full AOS flow', async () => {
    const audit = new MockAudit();
    const session = new MockSession();
    const agent = new PiAgentAdapter({
      id: 'test-aos-agent',
      name: 'Test AOS Agent',
      description: 'Integration test agent',
      systemPrompt: 'Test',
    });
    const mcp = new SdkMCPClient();
    const trigger = new CronTrigger({
      schedule: '0 9 * * *',
      timezone: 'Asia/Taipei',
      payload: { task: 'integration-test' },
    });

    // Step 1: Cron trigger
    await trigger.start({
      onTrigger: async (event) => {
        await audit.log({
          id: crypto.randomUUID(),
          type: 'aos.cron.triggered',
          actor: 'test-aos-agent',
          payload: event,
        });
      },
    });
    await (trigger as any).fireNow();
    await trigger.stop();
    expect(audit.events.length).toBe(1);

    // Step 2: Agent run
    const output = await agent.run({ prompt: 'integration test' }, session);
    expect(output.success).toBe(true);
    await audit.log({
      id: crypto.randomUUID(),
      type: 'aos.agent.completed',
      actor: 'test-aos-agent',
      payload: output,
    });

    // Step 3: MCP call
    await mcp.connect('http://test-mcp:8080/mcp/sse');
    const result = await mcp.callTool('test-tool', { test: true });
    await mcp.disconnect();
    expect(result.content.length).toBeGreaterThan(0);

    // Verify audit trail
    expect(audit.events.length).toBe(2);
    expect(audit.events[0].type).toBe('aos.cron.triggered');
    expect(audit.events[1].type).toBe('aos.agent.completed');
  });
});
