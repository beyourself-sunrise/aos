/**
 * PeerRegistry — tracks live AOS replicas via heartbeats.
 *
 * When a peer publishes a heartbeat, the registry updates
 * last_heartbeat and state. Peers that miss 10s become
 * 'unhealthy'; 30s become 'offline' and are removed from active lists.
 */
import { Client as PgClient } from 'pg';

interface PeerInfo {
  peerId: string;
  agentId: string;
  host: string;
  lastHeartbeat: Date;
  state: 'healthy' | 'unhealthy' | 'offline';
  capabilities: string[];
}

export class PeerRegistry {
  private peers = new Map<string, PeerInfo>();

  constructor(private pgClient: PgClient, private ownPeerId?: string) {}

  /** Register or update a peer heartbeat. */
  async heartbeat(peer: { peerId: string; agentId: string; host: string; capabilities?: string[] }): Promise<void> {
    await this.pgClient.query(
      `INSERT INTO aos_peer (peer_id, agent_id, host, last_heartbeat, state, capabilities)
       VALUES ($1, $2, $3, NOW(), 'healthy', $4)
       ON CONFLICT (peer_id) DO UPDATE SET
         last_heartbeat = NOW(), state = 'healthy',
         capabilities = EXCLUDED.capabilities, host = EXCLUDED.host`,
      [peer.peerId, peer.agentId, peer.host, JSON.stringify(peer.capabilities ?? [])],
    );

    this.peers.set(peer.peerId, {
      peerId: peer.peerId,
      agentId: peer.agentId,
      host: peer.host,
      lastHeartbeat: new Date(),
      state: 'healthy',
      capabilities: peer.capabilities ?? [],
    });
  }

  /** Mark a peer unhealthy and attempt to update PG. */
  markUnhealthy(peerId: string): void {
    const p = this.peers.get(peerId);
    if (p) { p.state = 'unhealthy'; }

    this.pgClient.query(
      `UPDATE aos_peer SET state = 'unhealthy' WHERE peer_id = $1`,
      [peerId],
    ).catch(() => {});
  }

  /** Mark a peer offline and remove from in-memory set. */
  async markOffline(peerId: string): Promise<void> {
    this.peers.delete(peerId);
    await this.pgClient.query(
      `UPDATE aos_peer SET state = 'offline' WHERE peer_id = $1`,
      [peerId],
    ).catch(() => {});
  }

  /** Get a peer by ID. */
  get(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /** List healthy peers, optionally filtered by agent. */
  listHealthy(agentId?: string): PeerInfo[] {
    const all = Array.from(this.peers.values()).filter(p => p.state === 'healthy');
    if (!agentId) return all;
    return all.filter(p => p.agentId === agentId);
  }

  /** List all peers. */
  listAll(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  /** Count of healthy peers. */
  get healthyCount(): number {
    return this.listHealthy().length;
  }

  /** Rehydrate from PG on startup. */
  async rehydrate(): Promise<void> {
    const { rows } = await this.pgClient.query(
      `SELECT peer_id, agent_id, host, last_heartbeat, state, capabilities
       FROM aos_peer WHERE state = 'healthy'`,
    );
    for (const row of rows) {
      this.peers.set(row.peer_id, {
        peerId: row.peer_id,
        agentId: row.agent_id,
        host: row.host,
        lastHeartbeat: row.last_heartbeat,
        state: row.state,
        capabilities: row.capabilities ?? [],
      });
    }
  }

  /** Run health check: mark peers unhealthy/offline based on heartbeat age. */
  async healthCheck(): Promise<{ unhealthy: string[]; offline: string[] }> {
    const now = Date.now();
    const unhealthy: string[] = [];
    const offline: string[] = [];

    for (const [peerId, peer] of this.peers) {
      const ageMs = now - peer.lastHeartbeat.getTime();
      if (ageMs > 30_000) {
        offline.push(peerId);
        await this.markOffline(peerId);
      } else if (ageMs > 10_000) {
        unhealthy.push(peerId);
        this.markUnhealthy(peerId);
      }
    }

    return { unhealthy, offline };
  }
}
