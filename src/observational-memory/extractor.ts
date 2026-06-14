/**
 * Extractor — end-of-session observation extraction from tool-call history.
 *
 * Called by AgentRunner.endSession(). Reads the session's tool-call
 * history and produces up to 5 candidate observations. Candidates are
 * deduped against existing rows (cosine < 0.97 → skip) before persisting.
 */
import { Client as PgClient } from 'pg';
import type { Audit } from '../../interfaces/audit';

interface ExtractedObs {
  agentId: string;
  content: string;
  type: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  sourceSessionId: string;
  scope: string;
}

interface ExtractionConfig {
  maxCandidates: number;
  dedupThreshold: number; // cosine similarity threshold: if >= this, skip
  defaultTtlDays: Record<string, number>;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  maxCandidates: 5,
  dedupThreshold: 0.97,
  defaultTtlDays: { action: 90, pattern: 180, fact: 180, insight: 365, preference: 365 },
};

/**
 * Extract observations from a session's tool-call history.
 */
export async function extractObservationsFromSession(
  pgClient: PgClient,
  threadId: string,
  agentId: string,
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>,
  audit?: Audit,
  config: Partial<ExtractionConfig> = {},
): Promise<number> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. Generate candidate observations from tool calls
  const candidates: ExtractedObs[] = [];
  for (const tc of toolCalls.slice(0, cfg.maxCandidates)) {
    const content = summarizeToolCall(tc);
    if (!content) continue;

    const type = classifyToolCall(tc.toolName);

    candidates.push({
      agentId,
      content,
      type,
      metadata: {
        toolName: tc.toolName,
        args: tc.args,
        result: tc.result,
      },
      embedding: await generateEmbedding(content), // placeholder — real impl uses Provider
      sourceSessionId: threadId,
      scope: 'agent',
    });
  }

  if (candidates.length === 0) return 0;

  // 2. Dedup against existing rows
  const embeddingStr = (embed: number[]) => `[${embed.join(',')}]`;
  let persisted = 0;

  for (const c of candidates) {
    // Check nearest neighbor cosine similarity
    const check = await pgClient.query(
      `SELECT 1 - (embedding <=> $1::vector(1536)) AS _score
       FROM aos_observation
       WHERE agent_id = $2 AND state = 'active'
       ORDER BY embedding <=> $1::vector(1536)
       LIMIT 1`,
      [embeddingStr(c.embedding), agentId],
    );

    const score = check.rows[0]?._score as number | undefined;
    if (score !== undefined && score >= cfg.dedupThreshold) continue; // too similar → skip

    // 3. Compute TTL from type
    const ttlDays = cfg.defaultTtlDays[c.type] ?? 90;
    const expiresAt = new Date(Date.now() + ttlDays * 86400 * 1000);

    // 4. Persist
    await pgClient.query(
      `INSERT INTO aos_observation
         (id, agent_id, content, embedding, type, metadata, origin_agent_id, scope, source_session_id, expires_at, state, created_at)
       VALUES ($1,$2,$3,$4::vector(1536),$5,$6,$7,$8,$9,$10,'active',NOW())`,
      [
        crypto.randomUUID(),
        agentId,
        c.content,
        embeddingStr(c.embedding),
        c.type,
        JSON.stringify(c.metadata),
        agentId,
        c.scope,
        c.sourceSessionId,
        expiresAt,
      ],
    );
    persisted++;

    if (audit) {
      await audit.log({
        id: crypto.randomUUID(),
        type: 'aos.observation.extracted',
        actor: agentId,
        payload: { type: c.type, sourceSessionId: c.sourceSessionId },
      });
    }
  }

  return persisted;
}

function summarizeToolCall(tc: {
  toolName: string;
  args: unknown;
  result: unknown;
}): string {
  const summary = [
    `Tool: ${tc.toolName}`,
    `Args: ${JSON.stringify(tc.args)}`,
    `Result: ${JSON.stringify(tc.result)}`,
  ].join(' | ');
  return summary.slice(0, 2048); // cap content at 2KB
}

function classifyToolCall(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes('create') || lower.includes('update') || lower.includes('delete')) return 'action';
  if (lower.includes('query') || lower.includes('find') || lower.includes('search')) return 'fact';
  if (lower.includes('approve') || lower.includes('reject') || lower.includes('review')) return 'insight';
  return 'action';
}

async function generateEmbedding(_content: string): Promise<number[]> {
  // Placeholder: real implementation delegates to Provider.embed()
  // For now, return a dummy 1536-dim vector
  return new Array(1536).fill(0).map(() => Math.random() * 0.1);
}
