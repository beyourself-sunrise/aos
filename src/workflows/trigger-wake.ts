/**
 * TriggerWake — matches Trigger events to waiting workflows and wakes them.
 *
 * When a Trigger event arrives, this module:
 * 1. Finds all waiting workflows with matching wakeOn conditions
 * 2. Transitions matching workflows from 'waiting' to 'running'
 * 3. Logs audit events for each wake
 */

import type { Audit } from '../interfaces/audit';
import type { TriggerEvent } from '../interfaces/trigger';
import { WorkflowRunner } from './runner';
import { StateMachine } from './state-machine';

/**
 * TriggerWake — handles trigger-to-workflow wake matching.
 */
export class TriggerWake {
  private stateMachine: StateMachine;

  constructor(
    private runner: WorkflowRunner,
    private audit?: Audit,
  ) {
    this.stateMachine = runner.getStateMachine();
  }

  /**
   * Process a trigger event and wake matching workflows.
   *
   * Returns the list of workflow IDs that were woken.
   */
  async processEvent(event: TriggerEvent): Promise<string[]> {
    const wokenIds: string[] = [];

    // Find waiting workflows that match this event
    const matchingWorkflows = await this.stateMachine.findWaitingByWakeOn({
      type: event.type,
      source: event.source,
      ...this.extractEventFields(event.payload),
    });

    for (const workflow of matchingWorkflows) {
      try {
        // Wake the workflow
        await this.runner.wakeWorkflow(workflow.id, {
          triggerEvent: {
            type: event.type,
            source: event.source,
            payload: this.summarizePayload(event.payload),
            timestamp: event.timestamp.toISOString(),
          },
        });

        wokenIds.push(workflow.id);

        // Audit log
        if (this.audit) {
          await this.audit.log({
            id: crypto.randomUUID(),
            type: 'aos.workflow.woken',
            actor: workflow.agentId,
            payload: {
              workflowId: workflow.id,
              workflowName: workflow.name,
              triggerType: event.type,
              triggerSource: event.source,
            },
          });
        }
      } catch (err) {
        // Log error but continue with other workflows
        console.error(`[TriggerWake] Failed to wake workflow ${workflow.id}:`, (err as Error).message);
      }
    }

    return wokenIds;
  }

  /**
   * Run timeout scan: find and fail expired waiting workflows.
   * Called by cron job every 5 minutes.
   */
  async scanTimeouts(): Promise<string[]> {
    const expired = await this.stateMachine.findExpired();
    const timedOutIds: string[] = [];

    for (const workflow of expired) {
      try {
        await this.runner.handleTimeout(workflow.id);
        timedOutIds.push(workflow.id);
      } catch (err) {
        console.error(`[TriggerWake] Failed to timeout workflow ${workflow.id}:`, (err as Error).message);
      }
    }

    return timedOutIds;
  }

  /**
   * Extract relevant fields from event payload for wakeOn matching.
   */
  private extractEventFields(payload: unknown): Record<string, unknown> {
    if (typeof payload === 'object' && payload !== null) {
      return payload as Record<string, unknown>;
    }
    return { raw: payload };
  }

  /**
   * Summarize payload for audit logging.
   */
  private summarizePayload(payload: unknown): string {
    if (typeof payload === 'string') return payload.slice(0, 200);
    if (typeof payload === 'object' && payload !== null) {
      return JSON.stringify(payload).slice(0, 200);
    }
    return String(payload).slice(0, 200);
  }
}
