import { describe, it, expect, beforeEach } from 'vitest';
import { PiAgentAdapter } from '../../src/adapters/agent/pi-agent-adapter';
import type { Session, SessionContext, SessionEntry, AgentEvent } from '../../src/interfaces/agent';

class MockSession implements Session {
  readonly threadId = 'test-session';
  private entries: SessionEntry[] = [];
  async getContext(): Promise<SessionContext> {
    return { history: this.entries, metadata: {} };
  }
  async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
  }
}

describe('PiAgentAdapter', () => {
  let agent: PiAgentAdapter;
  let session: Session;

  beforeEach(() => {
    agent = new PiAgentAdapter({
      id: 'test-agent',
      name: 'Test Agent',
      description: 'Test agent for unit tests',
      systemPrompt: 'Test system prompt',
    });
    session = new MockSession();
  });

  it('should have correct identity', () => {
    expect(agent.id).toBe('test-agent');
    expect(agent.name).toBe('Test Agent');
    expect(agent.description).toBe('Test agent for unit tests');
  });

  it('should run and return output', async () => {
    const output = await agent.run({ prompt: 'test prompt' }, session);
    expect(output.success).toBe(true);
    expect(output.response).toContain('test prompt');
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    expect(output.toolCalls).toEqual([]);
  });

  it('should emit events to subscribers', async () => {
    const events: AgentEvent[] = [];
    const unsub = agent.subscribe((event) => events.push(event));

    await agent.run({ prompt: 'test' }, session);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('started');

    unsub();
  });

  it('should handle cancellation', async () => {
    const events: AgentEvent[] = [];
    agent.subscribe((event) => events.push(event));

    await agent.cancel('test reason');
    const cancelled = events.find((e) => e.type === 'cancelled');
    expect(cancelled).toBeDefined();
  });
});
