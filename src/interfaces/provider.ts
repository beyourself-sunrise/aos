/**
 * AOS Provider Interface (SSOT)
 * LLM provider abstraction — unified interface for 18+ LLM providers.
 * OSS implementation: @earendil-works/pi-ai (MIT)
 */

export interface Provider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  countTokens(request: CompletionRequest): Promise<number>;
}

export interface CompletionRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  responseFormat?: ResponseFormat;
}

export interface CompletionResponse {
  text: string;
  usage: TokenUsage;
  toolCalls?: ToolCallResult[];
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error';
}

export interface CompletionChunk {
  text: string;
  isDone: boolean;
  toolCall?: ToolCallChunk;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCallResult {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallChunk {
  name: string;
  arguments: string;
}

export type ResponseFormat = 'text' | 'json' | 'structured';
