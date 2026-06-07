/**
 * SubscriptionRegistry — tracks which connections are subscribed to which threads.
 *
 * Uses two maps for O(1) lookups in both directions:
 * - forward: threadId → Set<connectionId>  (for broadcasting)
 * - reverse: connectionId → Set<threadId>  (for cleanup on disconnect)
 */

import type { SubscriptionRegistryInterface } from '../../interfaces/realtime';

export class SubscriptionRegistry implements SubscriptionRegistryInterface {
  // threadId → Set<connectionId>
  private subscriptions: Map<string, Set<string>> = new Map();

  // connectionId → Set<threadId>
  private reverse: Map<string, Set<string>> = new Map();

  subscribe(connectionId: string, threadId: string): void {
    if (!this.subscriptions.has(threadId)) {
      this.subscriptions.set(threadId, new Set());
    }
    this.subscriptions.get(threadId)!.add(connectionId);

    if (!this.reverse.has(connectionId)) {
      this.reverse.set(connectionId, new Set());
    }
    this.reverse.get(connectionId)!.add(threadId);
  }

  unsubscribe(connectionId: string, threadId: string): void {
    this.subscriptions.get(threadId)?.delete(connectionId);
    if (this.subscriptions.get(threadId)?.size === 0) {
      this.subscriptions.delete(threadId);
    }

    this.reverse.get(connectionId)?.delete(threadId);
    if (this.reverse.get(connectionId)?.size === 0) {
      this.reverse.delete(connectionId);
    }
  }

  unsubscribeAll(connectionId: string): void {
    const threadIds = this.reverse.get(connectionId);
    if (!threadIds) return;

    for (const threadId of threadIds) {
      this.subscriptions.get(threadId)?.delete(connectionId);
      if (this.subscriptions.get(threadId)?.size === 0) {
        this.subscriptions.delete(threadId);
      }
    }
    this.reverse.delete(connectionId);
  }

  getSubscribers(threadId: string): Set<string> {
    return this.subscriptions.get(threadId) ?? new Set();
  }

  getSubscriptionCount(threadId: string): number {
    return this.subscriptions.get(threadId)?.size ?? 0;
  }
}
