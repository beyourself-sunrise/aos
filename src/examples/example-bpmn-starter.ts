/**
 * Example: Start BPMN process
 *
 * Demonstrates AOS as BPMN initiator (not assignee).
 * AOS starts a workflow via Camunda 7 REST API.
 */

import { CamundaBpmnStarter } from '../adapters/bpmn/camunda-starter';
import type { Audit, AuditEvent } from '../interfaces/audit';

/** Mock audit for POC */
class MockAudit implements Audit {
  async log(event: AuditEvent): Promise<void> {
    console.log(`[Audit] ${event.type} by ${event.actor}:`, event.payload);
  }
  async query(): Promise<AuditEvent[]> { return []; }
}

export async function runBpmnStarterExample(): Promise<void> {
  console.log('[Example] BPMN Starter Demo');

  const audit = new MockAudit();
  const starter = new CamundaBpmnStarter(
    process.env.WORKFLOW_BASE_URL ?? 'http://workflow-module:8080/engine-rest',
    audit,
  );

  const result = await starter.startProcess('user-attendance-monthly-close', {
    month: '2026-06',
    initiator: 'aos',
  });

  console.log(`[BPMN] Process started: ${result.processInstanceId}`);
  console.log('[Example] BPMN Starter Demo complete');
}
