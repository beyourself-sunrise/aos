/**
 * AOS Memory Interface (SSOT)
 * Agent memory abstraction — short-term work context and long-term knowledge.
 * POC phase: interface only; pgvector implementation in aos-mvp.
 * OSS implementation: AOS self-written + pgvector (PostgreSQL License)
 */

export interface Memory {
  store(observation: Observation): Promise<void>;
  recall(query: MemoryQuery): Promise<MemoryEntry[]>;
}

export interface Observation {
  id: string;
  agentId: string;
  threadId?: string;
  content: string;
  type: 'fact' | 'preference' | 'pattern' | 'insight' | 'action';
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface MemoryQuery {
  query: string;
  agentId?: string;
  threadId?: string;
  types?: string[];
  limit?: number;
  minScore?: number;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  type: string;
  score?: number;
  metadata: Record<string, unknown>;
  timestamp: Date;
}
