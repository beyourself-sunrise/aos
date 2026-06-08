/**
 * Agent Runner — manages session lifecycle for persona agents.
 *
 * Handles:
 * - Session creation and context loading
 * - Observational Memory recall on session start
 * - Agent execution with tool calling
 * - Observational Memory write on session end
 * - Audit logging for all lifecycle events
 */

import type { Agent, AgentInput, AgentOutput, Session, SessionEntry, SessionContext } from '../interfaces/agent';
import type { Audit, AuditEvent } from '../interfaces/audit';
import type { Memory, Observation, MemoryQuery, MemoryEntry } from '../interfaces/memory';
import type { PersonaConfig } from './loader';

/** Session lifecycle states. */
export type SessionState = 'starting' | 'running' | 'completed' | 'failed';

/** Session lifecycle event. */
export interface SessionLifecycleEvent {
  sessionId: string;
  agentId: string;
  state: SessionState;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * AgentRunner — executes agent sessions with memory integration.
 */
export class AgentRunner {
  constructor(
    private audit: Audit,
    private memory: Memory | null = null,
  ) {}

  /**
   * Run a complete agent session lifecycle.
   *
   * 1. Start: recall observations, create session context
   * 2. Execute: run agent with tools
   * 3. Complete: write observation summary, log audit events
   */
  async run(
    agent: Agent,
    personaConfig: PersonaConfig,
    input: AgentInput,
  ): Promise<AgentOutput> {
    const sessionId = crypto.randomUUID();
    const session = this.createSession(sessionId, agent, personaConfig);

    // --- Phase 1: Start ---
    await this.onSessionStart(agent, personaConfig, session, input);

    try {
      // --- Phase 2: Execute ---
      const output = await agent.run(input, session);

      // --- Phase 3: Complete ---
      if (output.success) {
        await this.onSessionComplete(agent, personaConfig, session, output);
      } else {
        await this.onSessionFailed(agent, personaConfig, session, output);
      }

      return output;
    } catch (error) {
      await this.onSessionFailed(agent, personaConfig, session, {
        response: '',
        toolCalls: [],
        durationMs: 0,
        success: false,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Session start: recall observations and prepare context.
   */
  private async onSessionStart(
    agent: Agent,
    config: PersonaConfig,
    session: Session,
    input: AgentInput,
  ): Promise<void> {
    // Log execution started
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.execution.started',
      actor: agent.id,
      payload: {
        sessionId: session.threadId,
        prompt: input.prompt.slice(0, 200),
        persona: config.name,
      },
    });

    // Recall observations if memory is available
    let recalledContext = '';
    if (this.memory) {
      const observations = await this.recallObservations(agent.id, input.prompt, config.memoryPolicy.topK);
      if (observations.length > 0) {
        recalledContext = this.formatRecalledContext(observations);
      }
    }

    // Append recalled context to session
    if (recalledContext) {
      await session.appendEntry({
        id: crypto.randomUUID(),
        type: 'system',
        content: { text: recalledContext },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Session complete: write observation and log audit.
   */
  private async onSessionComplete(
    agent: Agent,
    config: PersonaConfig,
    session: Session,
    output: AgentOutput,
  ): Promise<void> {
    // Log execution completed
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.execution.completed',
      actor: agent.id,
      payload: {
        sessionId: session.threadId,
        durationMs: output.durationMs,
        toolCalls: output.toolCalls.length,
        persona: config.name,
      },
    });

    // Write observation if memory is available
    if (this.memory) {
      await this.writeObservation(agent.id, session, output, config);
    }
  }

  /**
   * Session failed: log audit event.
   */
  private async onSessionFailed(
    agent: Agent,
    config: PersonaConfig,
    session: Session,
    output: AgentOutput,
  ): Promise<void> {
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.execution.failed',
      actor: agent.id,
      payload: {
        sessionId: session.threadId,
        error: output.error,
        durationMs: output.durationMs,
        persona: config.name,
      },
    });
  }

  /**
   * Recall observations for the agent based on the input prompt.
   */
  private async recallObservations(
    agentId: string,
    query: string,
    topK: number,
  ): Promise<MemoryEntry[]> {
    if (!this.memory) return [];

    const memoryQuery: MemoryQuery = {
      query,
      agentId,
      limit: topK,
    };

    const results = await this.memory.recall(memoryQuery);

    // Log recall
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.observation.recalled',
      actor: agentId,
      payload: {
        query: query.slice(0, 100),
        count: results.length,
        topK,
      },
    });

    return results;
  }

  /**
   * Write observation after session completion.
   */
  private async writeObservation(
    agent: Agent,
    session: Session,
    output: AgentOutput,
    config: PersonaConfig,
  ): Promise<void> {
    if (!this.memory) return;

    // Create observation from session summary
    const observation: Observation = {
      id: crypto.randomUUID(),
      agentId: agent.id,
      threadId: session.threadId,
      content: this.summarizeSession(output),
      type: 'insight',
      metadata: {
        toolCalls: output.toolCalls.map((t) => t.name),
        durationMs: output.durationMs,
        persona: config.name,
      },
      timestamp: new Date(),
    };

    await this.memory.store(observation);

    // Log observation stored
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.observation.stored',
      actor: agent.id,
      payload: {
        observationId: observation.id,
        sessionId: session.threadId,
        type: observation.type,
      },
    });
  }

  /**
   * Create a session instance for the agent.
   */
  private createSession(
    sessionId: string,
    agent: Agent,
    config: PersonaConfig,
  ): Session {
    const entries: SessionEntry[] = [];

    return {
      threadId: sessionId,
      getContext: async (): Promise<SessionContext> => ({
        history: [...entries],
        metadata: {
          agentId: agent.id,
          persona: config.name,
          startedAt: new Date().toISOString(),
        },
      }),
      appendEntry: async (entry: SessionEntry): Promise<void> => {
        entries.push(entry);
      },
    };
  }

  /**
   * Summarize session output for observation storage.
   */
  private summarizeSession(output: AgentOutput): string {
    const toolSummary = output.toolCalls
      .map((t) => `${t.name}(${t.status})`)
      .join(', ');

    return `[${output.success ? 'SUCCESS' : 'FAILED'}] Response: ${output.response.slice(0, 500)} | Tools: ${toolSummary} | Duration: ${output.durationMs}ms`;
  }

  /**
   * Format recalled observations into context text.
   */
  private formatRecalledContext(entries: MemoryEntry[]): string {
    const lines = entries.map(
      (e) => `- [${e.type}] ${e.content} (score: ${e.score?.toFixed(3) ?? 'N/A'})`,
    );
    return `=== Recalled Observations (${entries.length}) ===\n${lines.join('\n')}\n=== End Recalled ===`;
  }
}
