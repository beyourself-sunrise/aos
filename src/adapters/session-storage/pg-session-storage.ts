/**
 * PgSessionStorage — PostgreSQL implementation of the SessionStorage interface.
 *
 * Features:
 * - Optimistic locking via version column + SELECT FOR UPDATE
 * - Conflict detection via ConflictResolver
 * - Audit logging via optional Audit interface
 * - Tree-structured entries via parent_id
 */

import { Client as PgClient } from 'pg';
import type {
  SessionStorage,
  SessionMetadata,
  SessionEntry,
  AppendResult,
  GetEntriesOptions,
} from '../../interfaces/session-storage';
import type { Audit } from '../../interfaces/audit';
import { ConflictResolver, ConflictError } from './conflict-resolver';

/**
 * PgSessionStorage — PG-backed implementation of SessionStorage.
 *
 * Uses optimistic locking (version column) for concurrent write safety.
 * Audit logging is optional — inject an Audit implementation to enable.
 */
export class PgSessionStorage implements SessionStorage {
  constructor(
    private pgClient: PgClient,
    private conflictResolver: ConflictResolver = new ConflictResolver(),
    private audit?: Audit,
  ) {}

  /**
   * Get session metadata by threadId.
   * Returns null if session doesn't exist.
   */
  async getMetadata(threadId: string): Promise<SessionMetadata | null> {
    const result = await this.pgClient.query(
      'SELECT id, thread_id, agent_id, metadata, leaf_id, version, created_at, updated_at ' +
        'FROM aos_session WHERE thread_id = $1',
      [threadId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      threadId: row.thread_id,
      agentId: row.agent_id,
      metadata: row.metadata,
      leafId: row.leaf_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get the current leaf entry ID for a session.
   * Returns null if no leaf is set.
   */
  async getLeafId(threadId: string): Promise<string | null> {
    const result = await this.pgClient.query(
      'SELECT leaf_id FROM aos_session WHERE thread_id = $1',
      [threadId],
    );

    return result.rows[0]?.leaf_id ?? null;
  }

  /**
   * Set the leaf entry ID for a session.
   * Uses optimistic locking via ConflictResolver.
   */
  async setLeafId(threadId: string, leafId: string): Promise<void> {
    await this.conflictResolver.retry(async () => {
      const sessionResult = await this.pgClient.query(
        'SELECT version FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        [threadId],
      );

      if (sessionResult.rows.length === 0) {
        throw new Error(`Session not found: ${threadId}`);
      }

      const currentVersion = sessionResult.rows[0].version;

      const updateResult = await this.pgClient.query(
        'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() ' +
          'WHERE thread_id = $2 AND version = $3',
        [leafId, threadId, currentVersion],
      );

      if (updateResult.rowCount === 0) {
        throw new ConflictError(threadId, currentVersion, currentVersion + 1);
      }

      // Audit
      if (this.audit) {
        await this.audit.log({
          id: crypto.randomUUID(),
          type: 'aos.session.leaf.changed',
          actor: 'aos-session-storage',
          payload: { threadId, leafId, version: currentVersion + 1 },
        });
      }
    });
  }

  /**
   * Generate a new entry ID (UUID v4).
   */
  async createEntryId(): Promise<string> {
    return crypto.randomUUID();
  }

  /**
   * Append an entry to a session.
   * Uses optimistic locking: SELECT FOR UPDATE + version check.
   * The entry becomes the new leaf.
   */
  async appendEntry(threadId: string, entry: SessionEntry): Promise<AppendResult> {
    return await this.conflictResolver.retry(async () => {
      // Lock the session row
      const sessionResult = await this.pgClient.query(
        'SELECT id, version, leaf_id FROM aos_session WHERE thread_id = $1 FOR UPDATE',
        [threadId],
      );

      if (sessionResult.rows.length === 0) {
        throw new Error(`Session not found: ${threadId}`);
      }

      const currentVersion = sessionResult.rows[0].version;
      const currentLeafId = sessionResult.rows[0].leaf_id;

      // Generate entry ID if not provided
      const entryId = entry.id ?? crypto.randomUUID();
      const parentId = entry.parentId ?? currentLeafId;

      // Atomic: insert entry + update session
      await this.pgClient.query('BEGIN');
      try {
        await this.pgClient.query(
          'INSERT INTO aos_session_entry (id, thread_id, parent_id, role, content, metadata) ' +
            'VALUES ($1, $2, $3, $4, $5, $6)',
          [
            entryId,
            threadId,
            parentId,
            entry.role,
            JSON.stringify(entry.content),
            JSON.stringify(entry.metadata ?? {}),
          ],
        );

        const updateResult = await this.pgClient.query(
          'UPDATE aos_session SET leaf_id = $1, version = version + 1, updated_at = NOW() ' +
            'WHERE thread_id = $2 AND version = $3',
          [entryId, threadId, currentVersion],
        );

        if (updateResult.rowCount === 0) {
          await this.pgClient.query('ROLLBACK');
          throw new ConflictError(threadId, currentVersion, currentVersion + 1);
        }

        await this.pgClient.query('COMMIT');

        // Audit
        if (this.audit) {
          await this.audit.log({
            id: crypto.randomUUID(),
            type: 'aos.session.entry.appended',
            actor: 'aos-session-storage',
            payload: {
              threadId,
              entryId,
              role: entry.role,
              version: currentVersion + 1,
            },
          });
        }

        return { entryId, version: currentVersion + 1, leafId: entryId };
      } catch (err) {
        await this.pgClient.query('ROLLBACK');
        throw err;
      }
    });
  }

  /**
   * Get a specific entry by ID.
   * Returns null if not found.
   */
  async getEntry(threadId: string, entryId: string): Promise<SessionEntry | null> {
    const result = await this.pgClient.query(
      'SELECT id, thread_id, parent_id, role, content, metadata, created_at ' +
        'FROM aos_session_entry WHERE id = $1 AND thread_id = $2',
      [entryId, threadId],
    );

    if (result.rows.length === 0) return null;

    return this.rowToEntry(result.rows[0]);
  }

  /**
   * Find entries for a session with optional filtering.
   * Returns entries ordered by created_at ASC.
   */
  async findEntries(
    threadId: string,
    options?: GetEntriesOptions,
  ): Promise<SessionEntry[]> {
    let query =
      'SELECT id, thread_id, parent_id, role, content, metadata, created_at ' +
      'FROM aos_session_entry WHERE thread_id = $1';
    const params: unknown[] = [threadId];

    if (options?.since) {
      params.push(options.since);
      query += ` AND created_at > $${params.length}`;
    }

    query += ' ORDER BY created_at ASC';

    if (options?.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await this.pgClient.query(query, params);
    return result.rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Get the label from an entry's metadata.
   * Returns null if not found.
   */
  async getLabel(threadId: string, entryId: string): Promise<string | null> {
    const result = await this.pgClient.query(
      "SELECT metadata->>'label' AS label FROM aos_session_entry WHERE id = $1 AND thread_id = $2",
      [entryId, threadId],
    );

    return result.rows[0]?.label ?? null;
  }

  /**
   * Get the path from an entry to the root (all ancestors).
   * Uses recursive CTE to walk parent_id chain.
   * Returns entries ordered from root to the target entry.
   */
  async getPathToRoot(threadId: string, entryId: string): Promise<SessionEntry[]> {
    const result = await this.pgClient.query(
      `WITH RECURSIVE path AS (
        SELECT id, thread_id, parent_id, role, content, metadata, created_at, 0 AS depth
        FROM aos_session_entry WHERE id = $1 AND thread_id = $2
        UNION ALL
        SELECT e.id, e.thread_id, e.parent_id, e.role, e.content, e.metadata, e.created_at, path.depth + 1
        FROM aos_session_entry e
        INNER JOIN path ON e.id = path.parent_id
      )
      SELECT * FROM path ORDER BY depth DESC`,
      [entryId, threadId],
    );

    return result.rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Get all entries for a session.
   * Shorthand for findEntries without options.
   */
  async getEntries(threadId: string): Promise<SessionEntry[]> {
    return this.findEntries(threadId);
  }

  /** Convert a DB row to SessionEntry. */
  private rowToEntry(row: Record<string, unknown>): SessionEntry {
    return {
      id: row.id as string,
      threadId: row.thread_id as string,
      parentId: row.parent_id as string | null,
      role: row.role as 'user' | 'assistant' | 'tool' | 'system',
      content: row.content as Record<string, unknown>,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.created_at as Date,
    };
  }
}
