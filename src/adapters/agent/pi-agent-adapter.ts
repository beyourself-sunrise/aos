/**
 * Pi Agent Adapter — wraps Pi SDK Agent to implement AOS Agent interface.
 *
 * Pi Agent = sprinter (single LLM-powered task execution)
 * AOS Adapter = marathon coach (manages schedule, session, signals, audit)
 */

import type { Agent, AgentInput, AgentOutput, Session, AgentEventListener, AgentEvent, Unsubscribe } from '../../interfaces/agent';

export interface PiAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools?: import('../../interfaces/agent').ToolDefinition[];
}

/**
 * PiAgentAdapter wraps Pi SDK Agent to implement AOS Agent interface.
 * AOS Adapter handles proactive lifecycle; Pi Agent provides execution capability.
 */
export class PiAgentAdapter implements Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private systemPrompt: string;
  private tools: import('../../interfaces/agent').ToolDefinition[];
  private listeners: Set<AgentEventListener> = new Set();

  constructor(config: PiAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools ?? [];
  }

  async run(input: AgentInput, session: Session): Promise<AgentOutput> {
    const startTime = Date.now();
    const event = (type: AgentEvent['type'], payload: unknown): void => {
      const evt: AgentEvent = { type, payload, timestamp: new Date() };
      for (const listener of this.listeners) {
        try { listener(evt); } catch { /* ignore listener errors */ }
      }
    };

    event('started', { prompt: input.prompt, sessionId: session.threadId });

    try {
      const context = await session.getContext();
      const response = await this.simulateLLMResponse(input, context);
      const toolCalls: import('../../interfaces/agent').ToolCall[] = [];

      for (const tool of this.tools) {
        const call: import('../../interfaces/agent').ToolCall = {
          name: tool.name,
          args: {},
          status: 'completed',
        };
        toolCalls.push(call);
        event('tool-call', { tool: tool.name, args: call.args });
      }

      event('response', { response });

      return {
        response,
        toolCalls,
        durationMs: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      event('error', { error: (error as Error).message });
      return {
        response: '',
        toolCalls: [],
        durationMs: Date.now() - startTime,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async cancel(reason: string): Promise<void> {
    const event: AgentEvent = { type: 'cancelled', payload: { reason }, timestamp: new Date() };
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  subscribe(listener: AgentEventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Simulate LLM response for POC (no actual LLM call needed) */
  private async simulateLLMResponse(
    input: AgentInput,
    _context: import('../../interfaces/agent').SessionContext,
  ): Promise<string> {
    // POC: simulate response without actual LLM call
    // In production, this would call through Provider interface
    return `[AOS Agent ${this.id}] Processed: ${input.prompt}`;
  }
}
