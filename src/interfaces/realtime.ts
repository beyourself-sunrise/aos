/**
 * AOS Realtime Interface (SSOT)
 * Cross-device real-time session tracking via SSE/WS.
 * POC phase: interface only; socket.io implementation in aos-cross-device-session-realtime.
 * OSS implementation: socket.io (MIT)
 */

export interface Realtime {
  subscribe(threadId: string, listener: RealtimeListener): Unsubscribe;
  publish(threadId: string, event: RealtimeEvent): Promise<void>;
  broadcast(event: RealtimeEvent): Promise<void>;
}

export interface RealtimeEvent {
  type: string;
  payload: unknown;
  timestamp: Date;
  sourceAgentId?: string;
}

export type RealtimeListener = (event: RealtimeEvent) => void | Promise<void>;
export type Unsubscribe = () => void;
