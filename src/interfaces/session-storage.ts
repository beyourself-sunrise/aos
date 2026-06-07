/**
 * AOS SessionStorage Interface (SSOT)
 * Session persistence and cross-device synchronization.
 * POC phase: interface only; PG implementation in aos-pg-session-storage.
 */

export interface SessionStorage {
  getMetadata(threadId: string): Promise<SessionMetadata | null>;
  appendEntry(threadId: string, entry: SessionEntry): Promise<AppendResult>;
  getEntries(threadId: string, options?: GetEntriesOptions): Promise<SessionEntry[]>;
  getLeafId(threadId: string): Promise<string | null>;
  setLeafId(threadId: string, leafId: string): Promise<void>;
}

export interface SessionMetadata {
  threadId: string;
  title: string;
  agentId: string;
  status: 'active' | 'suspended' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  version: number;
  metadata: Record<string, unknown>;
}

export interface SessionEntry {
  id: string;
  type: string;
  content: unknown;
  timestamp: Date;
  version: number;
}

export interface AppendResult {
  success: boolean;
  entryId: string;
  version: number;
  conflict?: ConflictInfo;
}

export interface ConflictInfo {
  type: 'version' | 'concurrent-write';
  expectedVersion: number;
  actualVersion: number;
}

export interface GetEntriesOptions {
  limit?: number;
  offset?: number;
  type?: string;
  order?: 'asc' | 'desc';
}
