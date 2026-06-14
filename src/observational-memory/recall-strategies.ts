/**
 * Recall strategies — three selectable recall paths.
 *
 * - semantic: vector cosine similarity (PG vector <-> operator)
 * - recency: vector + time-decay scoring
 * - hybrid (default, MVP): vector + full-text tsvector merge
 */
import { Client as PgClient } from 'pg';
import type { MemoryQuery, MemoryEntry } from '../../interfaces/memory';

const MIN_SCORE = 0.6;

export interface RecallResult {
  entries: MemoryEntry[];
  strategy: string;
}

/**
 * Semantic recall — pure vector similarity.
 */
export async function semanticRecall(
  client: PgClient,
  query: MemoryQuery,
): Promise<RecallResult> {
  if (!query.embedding) {
    throw new Error('semantic recall requires an embedding');
  }

  const embeddingStr = `[${query.embedding.join(',')}]`;
  const limit = Math.min(query.limit ?? 10, 50);

  let sql = `
    SELECT id, agent_id, content, type, metadata, embedding::text,
           created_at, 1 - (embedding <=> $1::vector(1536)) AS _score
    FROM aos_observation
    WHERE state = 'active'
      AND 1 - (embedding <=> $1::vector(1536)) >= $2
  `;
  const params: unknown[] = [embeddingStr, MIN_SCORE];

  let paramIdx = 3;
  if (query.agentId) {
    sql += ` AND agent_id = $${paramIdx}`;
    params.push(query.agentId);
    paramIdx++;
  }
  if (query.type) {
    sql += ` AND type = $${paramIdx}`;
    params.push(query.type);
    paramIdx++;
  }
  if (query.scopes && query.scopes.length > 0) {
    sql += ` AND scope IN (${query.scopes.map((_, i) => `$${paramIdx + i}`).join(',')})`;
    for (const s of query.scopes) params.push(s);
  }

  sql += ` ORDER BY _score DESC LIMIT $${paramIdx}`;
  params.push(limit);

  const { rows } = await client.query(sql, params);
  return { entries: rows.map(deserialize), strategy: 'semantic' };
}

/**
 * Recency recall — vector similarity with time-decay boost.
 */
export async function recencyRecall(
  client: PgClient,
  query: MemoryQuery,
): Promise<RecallResult> {
  if (!query.embedding) {
    throw new Error('recency recall requires an embedding');
  }

  const embeddingStr = `[${query.embedding.join(',')}]`;
  const limit = Math.min(query.limit ?? 10, 50);

  // Score = vector_similarity * time_decay
  // time_decay = 0.5 ^ (days_since_creation / 30) — 30-day half-life
  let sql = `
    SELECT id, agent_id, content, type, metadata, created_at,
           (1 - (embedding <=> $1::vector(1536)))
             * POW(0.5, EXTRACT(EPOCH FROM (NOW() - created_at)) / (86400 * 30)) AS _score
    FROM aos_observation
    WHERE state = 'active'
      AND 1 - (embedding <=> $1::vector(1536)) >= $2
  `;
  const params: unknown[] = [embeddingStr, MIN_SCORE];

  let paramIdx = 3;
  if (query.agentId) {
    sql += ` AND agent_id = $${paramIdx}`;
    params.push(query.agentId);
    paramIdx++;
  }
  if (query.type) {
    sql += ` AND type = $${paramIdx}`;
    params.push(query.type);
    paramIdx++;
  }
  if (query.scopes && query.scopes.length > 0) {
    sql += ` AND scope IN (${query.scopes.map((_, i) => `$${paramIdx + i}`).join(',')})`;
    for (const s of query.scopes) params.push(s);
  }

  sql += ` ORDER BY _score DESC LIMIT $${paramIdx}`;
  params.push(limit);

  const { rows } = await client.query(sql, params);
  return { entries: rows.map(deserialize), strategy: 'recency' };
}

function deserialize(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    content: row.content as string,
    type: row.type as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Date,
    embedding: row.embedding ? (typeof row.embedding === 'string' ? JSON.parse(row.embedding as string) : row.embedding) : undefined,
  } as MemoryEntry;
}
