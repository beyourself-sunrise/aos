/**
 * Network routes — peer health, leader assignments, delegations.
 *
 * GET /api/aos/network/peers       — list peers
 * GET /api/aos/network/leaders     — current leader per role
 * POST /api/aos/network/heartbeat  — register a peer heartbeat
 */
import type { FastifyInstance } from 'fastify';
import { PeerRegistry } from '../../../network/peer-registry';

export function registerNetworkRoutes(app: FastifyInstance, peerRegistry: PeerRegistry): void {
  app.get('/api/aos/network/peers', async (_request, reply) => {
    const peers = peerRegistry.listAll();
    return reply.send({ peers, count: peers.length, healthy: peerRegistry.healthyCount });
  });

  app.get('/api/aos/network/leaders', async (_request, reply) => {
    // Leader election is not yet implemented (follow-up P2 work)
    return reply.send({ leaders: [], note: 'Leader election pending' });
  });

  app.post('/api/aos/network/heartbeat', async (request, reply) => {
    const body = request.body as {
      peerId: string;
      agentId: string;
      host: string;
      capabilities?: string[];
    };

    if (!body.peerId || !body.agentId || !body.host) {
      return reply.status(400).send({ error: 'peerId, agentId, and host are required' });
    }

    await peerRegistry.heartbeat({
      peerId: body.peerId,
      agentId: body.agentId,
      host: body.host,
      capabilities: body.capabilities ?? [],
    });
    return reply.send({ success: true, peerId: body.peerId });
  });
}
