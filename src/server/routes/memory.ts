/**
 * Memory routes — per-agent observation stats and forget endpoints.
 *
 * GET  /api/aos/memory/agents/:id/stats      — observation counts by type/scope/state
 * POST /api/aos/memory/observations/:id/forget — soft-delete a single observation
 */
import type { FastifyInstance } from 'fastify';
import { Client as PgClient } from 'pg';
import type { Audit } from '../../../interfaces/audit';

export function registerMemoryRoutes(app: FastifyInstance, pgClient: PgClient, audit?: Audit): void {
  // Stats for an agent
  app.get('/api/aos/memory/agents/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };

    const counts = await pgClient.query(
      `SELECT type, scope, state, COUNT(*) as cnt
       FROM aos_observation
       WHERE agent_id = $1
       GROUP BY type, scope, state
       ORDER BY type, scope, state`,
      [id],
    );

    const total = counts.rows.reduce((sum: number, r: { cnt: number }) => sum + r.cnt, 0);

    return reply.send({
      agentId: id,
      total,
      breakdown: counts.rows,
    });
  });

  // Forget a single observation
  app.post('/api/aos/memory/observations/:id/forget', async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await pgClient.query(
      `UPDATE aos_observation
       SET state = 'expired', expired_at = NOW()
       WHERE id = $1 AND state = 'active'
       RETURNING agent_id`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: `Observation not found or already expired: ${id}` });
    }

    if (audit) {
      await audit.log({
        id: crypto.randomUUID(),
        type: 'aos.observation.forgotten',
        actor: result.rows[0].agent_id,
        payload: { observationId: id },
      });
    }

    return reply.send({ success: true, id });
  });
}
