/**
 * AOS Fastify HTTP Server
 *
 * Exposes dev endpoints for POC verification:
 * - POST /dev/trigger-cron — manually trigger cron
 * - POST /dev/start-bpmn — start a BPMN process
 * - POST /dev/call-mcp — call an MCP tool
 * - GET /health — health check
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { CronTrigger } from './adapters/trigger/cron/cron-trigger';
import { PiAgentAdapter } from './adapters/agent/pi-agent-adapter';
import { SdkMCPClient } from './adapters/mcp/client/mcp-client';
import { CamundaBpmnStarter } from './adapters/bpmn/camunda-starter';
import { AuditEventBridge } from './adapters/audit/audit-event-bridge';
import { createPgClient, connectPgClient, disconnectPgClient } from './adapters/pg/pg-client';
import { WorkflowRunner } from './workflows/runner';
import { WorkflowRegistry } from './workflows/registry';
import { StateMachine } from './workflows/state-machine';
import { registerMemoryRoutes } from './server/routes/memory';
import type { Session, SessionContext, SessionEntry } from './interfaces/agent';
import type { Audit, AuditEvent, AuditFilter } from './interfaces/audit';

class MockSession implements Session {
  readonly threadId = 'session-server';
  private entries: SessionEntry[] = [];
  async getContext(): Promise<SessionContext> {
    return { history: this.entries, metadata: {} };
  }
  async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FallbackAudit implements Audit {
  async log(event: AuditEvent): Promise<void> {
    console.log(`[Audit] ${event.type} by ${event.actor}:`, event.payload);
  }
  async query(): Promise<AuditEvent[]> { return []; }
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const fallbackAudit = new FallbackAudit();

  // PG client (optional — may not be available in all POC envs)
  let auditBridge: Audit = fallbackAudit;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const pgClient = createPgClient(databaseUrl);
      await connectPgClient(pgClient);
      auditBridge = new AuditEventBridge(pgClient);
      app.addHook('onClose', () => disconnectPgClient(pgClient));

      // Wire workflow runner + registry
      const stateMachine = new StateMachine(pgClient, auditBridge);
      const registry = await WorkflowRegistry.rehydrate(stateMachine);
      const runner = new WorkflowRunner(pgClient, auditBridge, registry);
      (app as any).workflowRunner = runner;

      // Register workflow routes
      registerWorkflowRoutes(app, runner);
      registerMemoryRoutes(app, pgClient, auditBridge);
      app.log.info(`[Workflow] Registry hydrated with ${registry.activeCount} active workflows`);
    } catch (err) {
      console.log('[Server] PG not available, using fallback audit:', (err as Error).message);
    }
  }

  const session = new MockSession();
  const agent = new PiAgentAdapter({
    id: 'aos-server-agent',
    name: 'AOS Server Agent',
    description: 'Server-side agent for dev endpoints',
    systemPrompt: '你是一個 AI 員工；透過 HTTP API 接收任務。',
  });

  const mcp = new SdkMCPClient();
  const starter = new CamundaBpmnStarter(
    process.env.WORKFLOW_BASE_URL ?? 'http://workflow-module:8080/engine-rest',
    auditBridge,
  );

  // Health check
  app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

  // POST /dev/trigger-cron
  app.post('/dev/trigger-cron', async () => {
    const trigger = new CronTrigger({
      schedule: '0 9 * * *',
      timezone: 'Asia/Taipei',
      payload: { task: 'manual-trigger' },
    });
    await trigger.start({
      onTrigger: async (event) => {
        await auditBridge.log({
          id: crypto.randomUUID(),
          type: 'aos.cron.triggered',
          actor: 'aos-server-agent',
          payload: event,
        });
        const output = await agent.run({ prompt: '執行手動觸發任務' }, session);
        await auditBridge.log({
          id: crypto.randomUUID(),
          type: 'aos.agent.completed',
          actor: 'aos-server-agent',
          payload: output,
        });
      },
    });
    await (trigger as any).fireNow();
    await trigger.stop();
    return { status: 'triggered' };
  });

  // POST /dev/start-bpmn
  app.post('/dev/start-bpmn', async (request, reply) => {
    const body = request.body as { processKey?: string; variables?: Record<string, unknown> };
    const processKey = body.processKey ?? 'user-attendance-monthly-close';
    const variables = body.variables ?? {};
    const result = await starter.startProcess(processKey, variables);
    reply.code(200);
    return { status: 'started', ...result };
  });

  // POST /dev/call-mcp
  app.post('/dev/call-mcp', async (request, reply) => {
    const body = request.body as { tool?: string; args?: unknown };
    const tool = body.tool ?? 'user-core.find-by-id';
    const args = body.args ?? {};
    await mcp.connect(process.env.MCP_USER_CORE_URL ?? 'http://user-core-module:8080/mcp/sse');
    const result = await mcp.callTool(tool, args);
    await mcp.disconnect();
    reply.code(200);
    return { status: 'ok', tool, result };
  });

  return app;
}
