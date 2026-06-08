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

export interface SessionEvent {
  threadId: string;
  type: string;
  version: number;
  payload?: unknown;
  deviceId?: string;
  entryId?: string;
  timestamp?: string | Date;
}

export interface SessionEventBus {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(event: SessionEvent): Promise<void>;
}

export interface SubscriptionRegistryInterface {
  subscribe(connectionId: string, threadId: string): void;
  unsubscribe(connectionId: string, threadId: string): void;
  unsubscribeAll(connectionId: string): void;
  getSubscribers(threadId: string): Set<string>;
  getSubscriptionCount(threadId: string): number;
}

export interface DeviceConflict {
  threadId: string;
  deviceA: string;
  deviceB: string;
  versionA: number;
  versionB: number;
  timestamp: number;
}

export interface ConflictResolverInterface {
  recordDeviceVersion(threadId: string, deviceId: string, version: number): void;
  detectConflict(threadId: string, deviceId: string, newVersion: number): DeviceConflict | null;
  resolveConflict(conflict: DeviceConflict): 'retry' | 'last-write-wins' | 'merge';
}

export type RealtimeListener = (event: RealtimeEvent) => void | Promise<void>;
export type Unsubscribe = () => void;
