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
   * Uses cosine distance on the embedding vector.
   */
  async recall(query: MemoryQuery): Promise<MemoryEntry[]> {
    // For v1, we use a simplified approach:
    // The query embedding must be provided or we fall back to text search
    const limit = query.limit ?? 10;

    // If we have a query string but no embedding, do text search fallback
    // In production, the caller would embed the query first
    let results;

    // Check if we have agent_id filter
    const hasAgentFilter = !!query.agentId;
    const hasTypeFilter = query.types && query.types.length > 0;

    // Build query with optional filters
    let sql = `
      SELECT id, agent_id, content, type, metadata, created_at,
             1 - (embedding <=> $1::vector) AS score
      FROM aos_observation
      WHERE 1=1
    `;
    const params: unknown[] = [];
    let paramIdx = 1;

    // For cosine similarity search, we need a query embedding
    // If no embedding is available, fall back to text search
    if (query.query && !hasAgentFilter) {
      // Fallback: full text search when no embedding
      sql = `
        SELECT id, agent_id, content, type, metadata, created_at, 0.5 AS score
        FROM aos_observation
        WHERE to_tsvector('english', content) @@ to_tsquery('english', $1)
      `;
      params.push(this.toTsQuery(query.query));
      paramIdx = 1;
    }

    if (hasAgentFilter) {
      sql += ` AND agent_id = $${paramIdx + 1}`;
      params.push(query.agentId);
      paramIdx++;
    }

    if (hasTypeFilter) {
      const typePlaceholders = query.types!.map((_, i) => `$${paramIdx + i}`).join(', ');
      sql += ` AND type IN (${typePlaceholders})`;
      params.push(...query.types!);
      paramIdx += query.types!.length;
    }

    if (query.threadId) {
      sql += ` AND source_session_id = $${paramIdx + 1}`;
      params.push(query.threadId);
      paramIdx++;
    }

    // Apply min score filter
    if (query.minScore !== undefined) {
      sql += ` AND score >= $${paramIdx + 1}`;
      params.push(query.minScore);
      paramIdx++;
    }

    sql += ` ORDER BY score DESC LIMIT $${paramIdx + 1}`;
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
