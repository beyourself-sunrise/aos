import { describe, it, expect } from 'vitest';
import { SubscriptionRegistry } from '../../src/adapters/realtime/subscription-registry';

describe('SubscriptionRegistry', () => {
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    registry = new SubscriptionRegistry();
  });

  it('should subscribe a connection to a thread', () => {
    registry.subscribe('conn-1', 'thread-1');
    expect(registry.getSubscribers('thread-1')).toContain('conn-1');
    expect(registry.getSubscriptionCount('thread-1')).toBe(1);
  });

  it('should handle multiple subscribers', () => {
    registry.subscribe('conn-1', 'thread-1');
    registry.subscribe('conn-2', 'thread-1');
    expect(registry.getSubscriptionCount('thread-1')).toBe(2);
  });

  it('should unsubscribe a connection', () => {
    registry.subscribe('conn-1', 'thread-1');
    registry.unsubscribe('conn-1', 'thread-1');
    expect(registry.getSubscriptionCount('thread-1')).toBe(0);
  });

  it('should unsubscribe all for a connection', () => {
    registry.subscribe('conn-1', 'thread-1');
    registry.subscribe('conn-1', 'thread-2');
    registry.unsubscribeAll('conn-1');
    expect(registry.getSubscriptionCount('thread-1')).toBe(0);
    expect(registry.getSubscriptionCount('thread-2')).toBe(0);
  });

  it('should return empty set for unknown thread', () => {
    expect(registry.getSubscribers('unknown')).toEqual(new Set());
  });

  it('should handle unsubscribe for non-existent connection', () => {
    registry.unsubscribe('nonexistent', 'thread-1');
    expect(registry.getSubscriptionCount('thread-1')).toBe(0);
  });
});
