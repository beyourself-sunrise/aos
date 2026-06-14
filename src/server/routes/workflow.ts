/**
 * Workflow routes — REST endpoints for operator workflow lifecycle controls.
 *
 * GET  /api/aos/workflows          — list active workflows (filter by agentId/state)
 * GET  /api/aos/workflows/:id       — get workflow instance with checkpoint
 * POST /api/aos/workflows/:id/suspend — suspend workflow (body: { reason })
 * POST /api/aos/workflows/:id/resume  — resume workflow (body: { restoreFromCheckpoint? })
 * POST /api/aos/workflows/:id/cancel  — cancel workflow (body: { reason })
 */
import type { FastifyInstance } from 'fastify';
import { WorkflowRunner } from '../../../workflows/runner';
import { WorkflowState } from '../../../workflows/state-machine';

export function registerWorkflowRoutes(app: FastifyInstance, runner: WorkflowRunner): void {
  // List active workflows
  app.get('/api/aos/workflows', async (request, reply) => {
    const { agentId, state } = request.query as {
      agentId?: string;
      state?: WorkflowState;
    };

    const sm = runner.getStateMachine();
    const workflows = agentId
      ? await sm.listByAgent(agentId, state)
      : [];

    return reply.send({ workflows, count: workflows.length });
  });

  // Get single workflow
  app.get('/api/aos/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const sm = runner.getStateMachine();
    const wf = await sm.get(id);

    if (!wf) {
      return reply.status(404).send({ error: `Workflow not found: ${id}` });
    }

    return reply.send(wf);
  });

  // Suspend a workflow
  app.post('/api/aos/workflows/:id/suspend', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    if (!reason || reason.trim().length === 0) {
      return reply.status(400).send({ error: 'reason is required' });
    }

    try {
      const wf = await runner.suspend(id, reason);
      return reply.send({ success: true, workflow: wf });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Resume a workflow
  app.post('/api/aos/workflows/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { restoreFromCheckpoint } = (request.body ?? {}) as {
      restoreFromCheckpoint?: boolean;
    };

    try {
      const wf = await runner.resume(id, { restoreFromCheckpoint });
      return reply.send({ success: true, workflow: wf });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Cancel a workflow
  app.post('/api/aos/workflows/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    if (!reason || reason.trim().length === 0) {
      return reply.status(400).send({ error: 'reason is required' });
    }

    try {
      const wf = await runner.cancel(id, reason);
      return reply.send({ success: true, workflow: wf });
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });
}
