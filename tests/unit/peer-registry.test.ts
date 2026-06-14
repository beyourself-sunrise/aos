import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerRegistry } from '../../src/network/peer-registry';
import { Client as PgClient } from 'pg';

function mockPgClient(): PgClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as PgClient;
}

describe('PeerRegistry', () => {
  let registry: PeerRegistry;
  let pg: PgClient;

  beforeEach(() => {
    pg = mockPgClient();
    registry = new PeerRegistry(pg, 'peer-001');
  });

  it('registers a peer heartbeat', async () => {
    await registry.heartbeat({ peerId: 'p1', agentId: 'hr', host: 'localhost:3001' });
    expect(registry.get('p1')).toBeDefined();
    expect(registry.get('p1')?.state).toBe('healthy');
    expect(registry.healthyCount).toBe(1);
  });

  it('marks peer unhealthy and offline', async () => {
    await registry.heartbeat({ peerId: 'p1', agentId: 'hr', host: 'h1' });
    registry.markUnhealthy('p1');
    expect(registry.get('p1')?.state).toBe('unhealthy');
    await registry.markOffline('p1');
    expect(registry.get('p1')).toBeUndefined();
  });

  it('listHealthy filters by agent', async () => {
    await registry.heartbeat({ peerId: 'p1', agentId: 'hr', host: 'h1' });
    await registry.heartbeat({ peerId: 'p2', agentId: 'finance', host: 'h2' });
    expect(registry.listHealthy('hr')).toHaveLength(1);
    expect(registry.listHealthy()).toHaveLength(2);
  });

  it('healthCheck detects stale heartbeats', async () => {
    await registry.heartbeat({ peerId: 'p1', agentId: 'hr', host: 'h1' });
    // Simulate an old heartbeat by overriding the peer's timestamp
    const peer = registry.get('p1')!;
    peer.lastHeartbeat = new Date(Date.now() - 35_000);
    const result = await registry.healthCheck();
    expect(result.offline).toContain('p1');
    expect(registry.get('p1')).toBeUndefined();
  });
});
