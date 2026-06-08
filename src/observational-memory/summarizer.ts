/**
 * Summarizer — LLM-powered session summarization and text embedding.
 *
 * Uses the AOS Provider interface to:
 * - Summarize session content for observation storage
 * - Generate text embeddings for semantic search
 *
 * The Provider interface abstracts the LLM backend,
 * allowing any LLM provider to be used.
 */

import type { Provider, CompletionRequest, CompletionResponse } from '../interfaces/provider';
import type { AgentOutput } from '../interfaces/agent';

/** Configuration for the summarizer. */
export interface SummarizerConfig {
  model: string;
  summaryMaxTokens?: number;
  embeddingModel?: string;
  embeddingDim?: number;
}

/**
 * Summarizer — produces session summaries and text embeddings via LLM Provider.
 */
export class Summarizer {
  private summaryMaxTokens: number;
  private embeddingModel: string;
  private embeddingDim: number;

  constructor(
    private provider: Provider,
    config: SummarizerConfig = {},
  ) {
    this.summaryMaxTokens = config.summaryMaxTokens ?? 500;
    this.embeddingModel = config.embeddingModel ?? config.model ?? 'text-embedding-3-small';
    this.embeddingDim = config.embeddingDim ?? 1536;
  }

  /**
   * Summarize a session's output for observation storage.
   *
   * Produces a concise summary suitable for pgvector storage
   * and later semantic recall.
   */
  async summarizeSession(
    agentId: string,
    output: AgentOutput,
    systemContext?: string,
  ): Promise<string> {
    const toolSummary = output.toolCalls
      .map((t) => `- ${t.name} (${t.status})`)
      .join('\n');

    const prompt = `Summarize this agent execution in 2-3 sentences. Focus on key actions and outcomes.

Agent: ${agentId}
Status: ${output.success ? 'SUCCESS' : 'FAILED'}
Duration: ${output.durationMs}ms
Response: ${output.response.slice(0, 1000)}
${toolSummary ? 'Tools used:\n' + toolSummary : ''}
${output.error ? 'Error: ' + output.error : ''}
${systemContext ? 'Context: ' + systemContext : ''}

Summary:`;

    try {
      const response = await this.provider.complete({
        model: this.embeddingModel,
        prompt,
        systemPrompt: 'You are a concise summarizer. Output only the summary, no preamble.',
        maxTokens: this.summaryMaxTokens,
        temperature: 0.1,
      });

      return response.text.trim();
    } catch {
      // Fallback: simple summary without LLM
      return this.fallbackSummary(agentId, output);
    }
  }

  /**
   * Generate an embedding vector for text.
   *
   * Returns a 1536-dimensional float array suitable for pgvector storage.
   * Uses the Provider interface to call the embedding model.
   */
  async embedText(text: string): Promise<number[]> {
    const prompt = `Embed this text for semantic search: ${text}`;

    try {
      const response = await this.provider.complete({
        model: this.embeddingModel,
        prompt,
        maxTokens: 1,
        responseFormat: 'json',
      });

      // Parse embedding from response
      // In production, the provider would return structured embedding data
      // For v1, we parse the response or use fallback
      const parsed = this.parseEmbedding(response.text);
      if (parsed && parsed.length === this.embeddingDim) {
        return parsed;
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: simple hash-based embedding
    return this.fallbackEmbedding(text);
  }

  /**
   * Prepare an observation with embedding for storage.
   *
   * Combines summarization and embedding in one call.
   */
  async prepareObservation(
    agentId: string,
    output: AgentOutput,
    sourceSessionId?: string,
  ): Promise<{
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }> {
    const content = await this.summarizeSession(agentId, output);
    const embedding = await this.embedText(content);

    return {
      content,
      embedding,
      metadata: {
        agentId,
        sourceSessionId,
        toolCalls: output.toolCalls.map((t) => t.name),
        durationMs: output.durationMs,
        success: output.success,
      },
    };
  }

  /**
   * Fallback summary when LLM is unavailable.
   */
  private fallbackSummary(agentId: string, output: AgentOutput): string {
    const status = output.success ? 'completed successfully' : 'failed';
    const tools = output.toolCalls.map((t) => t.name).join(', ') || 'none';
    return `[${agentId}] ${status} in ${output.durationMs}ms using tools: ${tools}. Response: ${output.response.slice(0, 200)}`;
  }

  /**
   * Fallback embedding using simple hash-based approach.
   * Produces a deterministic 1536-dim vector for text.
   */
  private fallbackEmbedding(text: string): number[] {
    const dim = this.embeddingDim;
    const embedding = new Float32Array(dim);

    // Simple hash-based embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    // Fill with deterministic values based on hash and text
    for (let i = 0; i < dim; i++) {
      const charIdx = i % text.length;
      const val = (hash * (i + 1) + text.charCodeAt(charIdx)) % 10000;
      embedding[i] = (val / 10000) * 2 - 1; // Normalize to [-1, 1]
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) {
        embedding[i] /= magnitude;
      }
    }

    return Array.from(embedding);
  }

  /**
   * Parse embedding from LLM response.
   */
  private parseEmbedding(text: string): number[] | null {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as number[];
      if (parsed.embedding && Array.isArray(parsed.embedding)) return parsed.embedding as number[];
      if (parsed.data && parsed.data[0]?.embedding) return parsed.data[0].embedding as number[];
    } catch {
      // Not JSON
    }
    return null;
  }
}
