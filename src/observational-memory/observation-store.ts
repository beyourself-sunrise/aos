/**
 * ObservationStore — pgvector-backed implementation of AOS Memory interface.
 *
 * Provides:
 * - writeObservation: store observation with embedding
 * - recallObservations: semantic search using cosine distance
 *
 * Requires pgvector extension on PostgreSQL.
 */

import { Client as PgClient } from 'pg';
import type { Memory, Observation, MemoryQuery, MemoryEntry } from '../interfaces/memory';

/** Result of a recall query. */
export interface RecallResult {
  entries: MemoryEntry[];
  total: number;
}

/**
 * ObservationStore — pgvector implementation of Memory interface.
 */
export class ObservationStore implements Memory {
  constructor(private pgClient: PgClient) {}

  /**
   * Store an observation with its embedding vector.
   */
  async store(observation: Observation): Promise<void> {
    // Generate embedding if not provided (caller should provide via summarizer)
    const embedding = this.getEmbedding(observation);

    await this.pgClient.query(
      `INSERT INTO aos_observation (id, agent_id, content, embedding, source_session_id, type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        observation.id,
        observation.agentId,
        observation.content,
        embedding ? JSON.stringify(embedding) : null,
        observation.threadId ?? null,
        observation.type,
        JSON.stringify(observation.metadata ?? {}),
      ],
    );
  }

  /**
   * Recall observations semantically similar to the query.
   *
   * Search strategy (decided per call):
   * - If `embedding` is provided on the query, use vector cosine similarity
   * - Else if `query.query` string is provided, fall back to full-text search
   *   (works with or without agent/type/thread filters)
   * - Else, return observations matching the filters with neutral score
   */
  async recall(query: MemoryQuery): Promise<MemoryEntry[]> {
    const limit = query.limit ?? 10;

    // Read optional embedding from query (callers may pre-embed the query)
    const queryEmbedding = (query as { embedding?: number[] }).embedding;
    const useVector = Array.isArray(queryEmbedding) && queryEmbedding.length > 0;
    const useTextSearch = !useVector && typeof query.query === 'string' && query.query.length > 0;

    const params: unknown[] = [];
    let paramIdx = 0;
    const conditions: string[] = [];

    let sql: string;
    if (useVector) {
      paramIdx++;
      sql = `
        SELECT id, agent_id, content, type, metadata, created_at,
               1 - (embedding <=> $${paramIdx}::vector) AS score
        FROM aos_observation
        WHERE 1=1
      `;
      params.push(JSON.stringify(queryEmbedding));
    } else if (useTextSearch) {
      paramIdx++;
      sql = `
        SELECT id, agent_id, content, type, metadata, created_at, 0.5 AS score
        FROM aos_observation
        WHERE to_tsvector('english', content) @@ to_tsquery('english', $${paramIdx})
      `;
      params.push(this.toTsQuery(query.query!));
    } else {
      sql = `
        SELECT id, agent_id, content, type, metadata, created_at, 1.0 AS score
        FROM aos_observation
        WHERE 1=1
      `;
    }

    if (query.agentId) {
      paramIdx++;
      conditions.push(`agent_id = $${paramIdx}`);
      params.push(query.agentId);
    }

    if (query.types && query.types.length > 0) {
      const placeholders = query.types.map((_, i) => {
        paramIdx++;
        return `$${paramIdx}`;
      });
      conditions.push(`type IN (${placeholders.join(', ')})`);
      params.push(...query.types);
    }

    if (query.threadId) {
      paramIdx++;
      conditions.push(`source_session_id = $${paramIdx}`);
      params.push(query.threadId);
    }

    if (query.minScore !== undefined) {
      paramIdx++;
      conditions.push(`score >= $${paramIdx}`);
      params.push(query.minScore);
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    paramIdx++;
    sql += ` ORDER BY score DESC LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await this.pgClient.query(sql, params);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      agentId: row.agent_id as string,
      content: row.content as string,
      type: row.type as string,
      score: row.score as number,
      metadata: row.metadata as Record<string, unknown>,
      timestamp: row.created_at as Date,
    }));
  }

  /**
   * Get embedding from observation (caller should provide).
   * For v1, embedding is expected to be in metadata.
   */
  private getEmbedding(observation: Observation): number[] | null {
    // Check if embedding is stored in metadata
    const meta = observation.metadata ?? {};
    if (meta.embedding && Array.isArray(meta.embedding)) {
      return meta.embedding as number[];
    }
    // For v1, return null — the summarizer will handle embedding
    return null;
  }

  /**
   * Convert a query string to PostgreSQL tsquery format.
   * Simple fallback for text search when vector search is not available.
   */
  private toTsQuery(query: string): string {
    // Simple: replace spaces with AND, escape special chars
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.replace(/'/g, "\\'"))
      .join(' & ');
  }

  /**
   * Delete observations for an agent (cleanup).
   */
  async deleteByAgent(agentId: string): Promise<number> {
    const result = await this.pgClient.query(
      'DELETE FROM aos_observation WHERE agent_id = $1',
      [agentId],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Get observation count for an agent.
   */
  async countByAgent(agentId: string): Promise<number> {
    const result = await this.pgClient.query(
      'SELECT COUNT(*) as count FROM aos_observation WHERE agent_id = $1',
      [agentId],
    );
    return parseInt(result.rows[0].count as string, 10);
  }
}
