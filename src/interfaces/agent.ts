/**
 * AOS Agent Interface (SSOT)
 *
 * The Agent interface is the execution unit abstraction — tool calling loop,
 * event streaming, session binding. OSS implementation: @earendil-works/pi-agent-core.
 *
 * AOS Adapter vs Pi Agent:
 * - Pi Agent = sprinter (single LLM-powered task execution)
 * - AOS Adapter = marathon coach (manages schedule, session, signals, audit)
 */

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  run(input: AgentInput, session: Session): Promise<AgentOutput>;
  cancel(reason: string): Promise<void>;
  subscribe(listener: AgentEventListener): Unsubscribe;
}

export interface AgentInput {
  prompt: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  metadata?: Record<string, unknown>;
}

export interface AgentOutput {
  response: string;
  toolCalls: ToolCall[];
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface Session {
  readonly threadId: string;
  getContext(): Promise<SessionContext>;
  appendEntry(entry: SessionEntry): Promise<void>;
}

export interface SessionContext {
  history: SessionEntry[];
  metadata: Record<string, unknown>;
}

export interface SessionEntry {
  id: string;
  type: string;
  content: unknown;
  timestamp: Date;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'completed' | 'failed';
}

export interface AgentEvent {
  type: 'started' | 'tool-call' | 'response' | 'error' | 'cancelled';
  payload: unknown;
  timestamp: Date;
}

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;
export type Unsubscribe = () => void;
