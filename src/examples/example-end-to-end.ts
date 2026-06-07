/**
 * Example: End-to-end AOS flow
 *
 * Demonstrates the complete AOS flow:
 * Cron trigger → Agent run → MCP tool call → BPMN start → Audit log
 */

import { CronTrigger } from '../adapters/trigger/cron/cron-trigger';
import { PiAgentAdapter } from '../adapters/agent/pi-agent-adapter';
import { SdkMCPClient } from '../adapters/mcp/client/mcp-client';
import { CamundaBpmnStarter } from '../adapters/bpmn/camunda-starter';
import type { Session, SessionContext, SessionEntry } from '../interfaces/agent';
import type { Audit, AuditEvent, AuditFilter } from '../interfaces/audit';

class MockSession implements Session {
  readonly threadId = 'session-e2e';
  private entries: SessionEntry[] = [];
  async getContext(): Promise<SessionContext> {
    return { history: this.entries, metadata: {} };
  }
  async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class MockAudit implements Audit {
  events: AuditEvent[] = [];
  async log(event: AuditEvent): Promise<void> {
    this.events.push(event);
    console.log(`[Audit] ${event.type} by ${event.actor}`);
  }
  async query(_filter: AuditFilter): Promise<AuditEvent[]> {
    return this.events;
  }
}

export async function runEndToEndExample(): Promise<void> {
  console.log('[Example] End-to-End AOS Flow');

  const audit = new MockAudit();
  const session = new MockSession();
  const agent = new PiAgentAdapter({
    id: 'aos-e2e-agent',
    name: 'AOS E2E Agent',
    description: 'End-to-end demo agent',
    systemPrompt: '你是一個 AI 員工；執行端到端演示任務。',
  });
  const mcp = new SdkMCPClient();
  const starter = new CamundaBpmnStarter(
    process.env.WORKFLOW_BASE_URL ?? 'http://workflow-module:8080/engine-rest',
    audit,
  );

  // Step 1: Cron trigger fires
  console.log('[Step 1] Cron trigger fires');
  const trigger = new CronTrigger({
    schedule: '0 9 * * *',
    timezone: 'Asia/Taipei',
    payload: { task: 'monthly-report' },
  });

  // Step 2: Agent runs
  console.log('[Step 2] Agent runs');
  const output = await agent.run({ prompt: '執行月度報告任務' }, session);
  console.log(`[Agent] ${output.response}`);

  // Step 3: MCP tool call
  console.log('[Step 3] MCP tool call');
  await mcp.connect('http://user-core-module:8080/mcp/sse');
  const result = await mcp.callTool('user-core.find-by-id', { userId: 'agent-aos-001' });
  console.log('[MCP] Result:', result);
  await mcp.disconnect();

  // Step 4: BPMN start
  console.log('[Step 4] BPMN process start');
  const bpmnResult = await starter.startProcess('user-attendance-monthly-close', {
    month: '2026-06',
    initiator: 'aos',
  });
  console.log(`[BPMN] Process: ${bpmnResult.processInstanceId}`);

  // Step 5: Audit log
  console.log('[Step 5] Audit log');
  await audit.log({
    id: crypto.randomUUID(),
    type: 'aos.e2e.completed',
    actor: 'aos-e2e-agent',
    payload: { output, bpmnResult },
  });

  console.log('[Example] End-to-End AOS Flow complete');
}
