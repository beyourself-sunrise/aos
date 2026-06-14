/**
 * WorkflowRunner — orchestrates workflow execution lifecycle.
 *
 * Provides:
 * - startWorkflow: create and begin a workflow
 * - runSyncStep: execute a synchronous step
 * - awaitAsyncStep: wait for an async event (trigger/webhook)
 * - completeWorkflow: mark workflow as done
 * - failWorkflow: mark workflow as failed
 */

import { Client as PgClient } from 'pg';
import type { Audit } from '../interfaces/audit';
import { StateMachine, WorkflowState, WorkflowInstance } from './state-machine';
import { WorkflowRegistry } from './registry';

/** Step function for synchronous execution. */
export type StepFn = (context: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Async step configuration. */
export interface AsyncStepConfig {
  /** Step identifier. */
  step: string;
  /** Conditions to wake the workflow. */
  wakeOn: Record<string, unknown>;
  /** Timeout in milliseconds (default: 24 hours). */
  timeoutMs?: number;
}

/**
 * WorkflowRunner — manages workflow execution.
 */
export class WorkflowRunner {
  private stateMachine: StateMachine;
  public readonly registry: WorkflowRegistry;

  constructor(
    private pgClient: PgClient,
    private audit?: Audit,
    registry?: WorkflowRegistry,
  ) {
    this.stateMachine = new StateMachine(pgClient, audit);
    this.registry = registry ?? new WorkflowRegistry();
  }

  /**
   * Get the underlying state machine for advanced operations.
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  /**
   * Start a new workflow.
   * Creates the workflow instance in 'pending' state, then transitions to 'running'.
   */
  async startWorkflow(
    agentId: string,
    name: string,
    initialContext: Record<string, unknown> = {},
  ): Promise<WorkflowInstance> {
    const id = crypto.randomUUID();

    // Insert workflow in pending state
    await this.pgClient.query(
      'INSERT INTO aos_workflow (id, agent_id, name, state, context_json, version) ' +
        'VALUES ($1, $2, $3, $4, $5, $6)',
      [id, agentId, name, 'pending', JSON.stringify(initialContext), 0],
    );

    // Transition to running
    const result = await this.stateMachine.transition(id, 'pending', 'running', {
      startedAt: new Date().toISOString(),
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to start workflow: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Run a synchronous step within a running workflow.
   * The step function receives the current context and returns updated context.
   */
  async runSyncStep(
    id: string,
    step: string,
    fn: StepFn,
  ): Promise<WorkflowInstance> {
    const workflow = await this.stateMachine.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    if (workflow.state !== 'running') {
      throw new Error(`Workflow is not running (state: ${workflow.state})`);
    }

    // Execute step
    const updatedContext = await fn(workflow.contextJson);

    // Update context with step result
    const result = await this.stateMachine.transition(id, 'running', 'running', {
      currentStep: step,
      stepCompleted: step,
      ...updatedContext,
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to complete step: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Transition to waiting state, awaiting an async event.
   * The workflow will be woken when a matching trigger event arrives.
   */
  async awaitAsyncStep(
    id: string,
    config: AsyncStepConfig,
  ): Promise<WorkflowInstance> {
    const workflow = await this.stateMachine.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    if (workflow.state !== 'running') {
      throw new Error(`Workflow is not running (state: ${workflow.state})`);
    }

    const timeoutMs = config.timeoutMs ?? 24 * 60 * 60 * 1000; // 24 hours default
    const timeoutAt = new Date(Date.now() + timeoutMs);

    const result = await this.stateMachine.transition(id, 'running', 'waiting', {
      currentStep: config.step,
      wakeOn: config.wakeOn,
      waitingSince: new Date().toISOString(),
      timeoutAt: timeoutAt.toISOString(),
    });

    // Also update timeout_at column
    await this.pgClient.query(
      'UPDATE aos_workflow SET timeout_at = $1 WHERE id = $2',
      [timeoutAt, id],
    );

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to enter waiting state: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Complete a workflow successfully.
   */
  async completeWorkflow(
    id: string,
    finalContext?: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const workflow = await this.stateMachine.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const fromState: WorkflowState = workflow.state === 'waiting' ? 'waiting' : 'running';

    const result = await this.stateMachine.transition(id, fromState, 'done', {
      completedAt: new Date().toISOString(),
      ...finalContext,
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to complete workflow: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Fail a workflow with an error message.
   */
  async failWorkflow(
    id: string,
    reason: string,
  ): Promise<WorkflowInstance> {
    const workflow = await this.stateMachine.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const fromState: WorkflowState =
      workflow.state === 'waiting' ? 'waiting' :
      workflow.state === 'running' ? 'running' : 'pending';

    const result = await this.stateMachine.transition(id, fromState, 'failed', {
      failedAt: new Date().toISOString(),
      reason,
    });

    // Also update error_message column
    await this.pgClient.query(
      'UPDATE aos_workflow SET error_message = $1 WHERE id = $2',
      [reason, id],
    );

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to fail workflow: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Suspend a running workflow, saving its context as checkpoint.
   */
  async suspend(id: string, reason: string): Promise<WorkflowInstance> {
    const wf = await this.stateMachine.get(id);
    if (!wf) throw new Error(`Workflow not found: ${id}`);

    const fromState: WorkflowState =
      wf.state === 'running' ? 'running' :
      wf.state === 'waiting' ? 'waiting' : wf.state;

    // Validate
    const allowed = ['running', 'waiting'];
    if (!allowed.includes(fromState)) {
      throw new Error(`Cannot suspend workflow in state: ${fromState}`);
    }

    // Save checkpoint (deep copy of current context)
    const checkpoint = JSON.parse(JSON.stringify(wf.contextJson));

    // Update checkpoint column
    await this.pgClient.query(
      'UPDATE aos_workflow SET checkpoint = $1 WHERE id = $2',
      [JSON.stringify(checkpoint), id],
    );

    // Transition to suspended
    const result = await this.stateMachine.transition(id, fromState, 'suspended', {
      suspendedAt: new Date().toISOString(),
      reason,
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to suspend workflow: ${result.error}`);
    }

    this.registry.markSuspended(result.workflow);

    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.suspended',
        actor: result.workflow.agentId,
        payload: { workflowId: id, reason, fromState },
      });
    }

    return result.workflow;
  }

  /**
   * Resume a suspended workflow, optionally restoring from checkpoint.
   */
  async resume(
    id: string,
    opts: { restoreFromCheckpoint?: boolean } = {},
  ): Promise<WorkflowInstance> {
    const wf = await this.stateMachine.get(id);
    if (!wf) throw new Error(`Workflow not found: ${id}`);

    if (wf.state !== 'suspended') {
      throw new Error(`Workflow is not suspended (state: ${wf.state})`);
    }

    const restoreFromCheckpoint = opts.restoreFromCheckpoint !== false; // default true
    const contextUpdate: Record<string, unknown> = {
      resumedAt: new Date().toISOString(),
    };

    if (restoreFromCheckpoint && wf.checkpoint) {
      // Merge checkpoint back into context
      Object.assign(contextUpdate, wf.checkpoint);
    }

    const result = await this.stateMachine.transition(id, 'suspended', 'running', contextUpdate);

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to resume workflow: ${result.error}`);
    }

    this.registry.markRunning(result.workflow);

    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.resumed',
        actor: result.workflow.agentId,
        payload: { workflowId: id, restoredFromCheckpoint: restoreFromCheckpoint },
      });
    }

    return result.workflow;
  }

  /**
   * Cancel a workflow. Idempotent if already cancelled.
   */
  async cancel(id: string, reason: string): Promise<WorkflowInstance> {
    const wf = await this.stateMachine.get(id);
    if (!wf) throw new Error(`Workflow not found: ${id}`);

    if (wf.state === 'cancelled') {
      // Idempotent: already cancelled
      if (this.audit) {
        await this.audit.log({
          id: crypto.randomUUID(),
          type: 'aos.workflow.cancelled',
          actor: wf.agentId,
          payload: { workflowId: id, reason, note: 'already cancelled', idempotent: true },
        });
      }
      return wf;
    }

    if (wf.state === 'done' || wf.state === 'failed') {
      throw new Error(`Cannot cancel terminal workflow (state: ${wf.state})`);
    }

    const fromState: WorkflowState = wf.state;
    const result = await this.stateMachine.transition(id, fromState, 'cancelled', {
      cancelledAt: new Date().toISOString(),
      cancelReason: reason,
    });

    // Also update cancelled_at and cancel_reason columns
    await this.pgClient.query(
      'UPDATE aos_workflow SET cancelled_at = NOW(), cancel_reason = $1 WHERE id = $2',
      [reason, id],
    );

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to cancel workflow: ${result.error}`);
    }

    this.registry.markDone(id);

    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.cancelled',
        actor: result.workflow.agentId,
        payload: { workflowId: id, reason, fromState },
      });
    }

    return result.workflow;
  }

  /**
   * Start a sub-workflow from a parent workflow.
   */
  async startSubWorkflow(
    parentId: string,
    agentId: string,
    name: string,
    initialContext: Record<string, unknown> = {},
  ): Promise<WorkflowInstance> {
    // Validate parent exists and is in a valid state
    const parent = await this.stateMachine.get(parentId);
    if (!parent) throw new Error(`Parent workflow not found: ${parentId}`);

    const validParentStates: WorkflowState[] = ['running', 'waiting', 'suspended'];
    if (!validParentStates.includes(parent.state)) {
      throw new Error(`Cannot start sub-workflow from parent in state: ${parent.state}`);
    }

    const childId = crypto.randomUUID();

    // Insert child workflow with parent reference
    await this.pgClient.query(
      `INSERT INTO aos_workflow (id, agent_id, name, state, context_json, parent_id, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [childId, agentId, name, 'pending', JSON.stringify(initialContext), parentId, 0],
    );

    // Transition child to running
    const result = await this.stateMachine.transition(childId, 'pending', 'running', {
      startedAt: new Date().toISOString(),
      parentWorkflowId: parentId,
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to start sub-workflow: ${result.error}`);
    }

    this.registry.markRunning(result.workflow);

    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.subworkflow.started',
        actor: agentId,
        payload: { workflowId: childId, parentWorkflowId: parentId, name },
      });
    }

    return result.workflow;
  }

  /**
   * Join a child workflow's result into the parent.
   */
  async joinChildWorkflow(
    childId: string,
    childContext: Record<string, unknown>,
  ): Promise<void> {
    const child = await this.stateMachine.get(childId);
    if (!child) throw new Error(`Child workflow not found: ${childId}`);

    const parentId = child.parentId;
    if (!parentId) throw new Error(`Workflow ${childId} has no parent`);

    const parent = await this.stateMachine.get(parentId);
    if (!parent) throw new Error(`Parent workflow not found: ${parentId}`);

    // Merge child result into parent context
    const currentChildren = (parent.contextJson?.childResults as Record<string, unknown>[]) ?? [];
    currentChildren.push({
      childId,
      name: child.name,
      state: child.state,
      context: childContext,
      joinedAt: new Date().toISOString(),
    });

    await this.stateMachine.transition(parentId, parent.state, parent.state, {
      childResults: currentChildren,
    });

    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.subworkflow.completed',
        actor: parent.agentId,
        payload: { workflowId: childId, parentWorkflowId: parentId, childName: child.name },
      });
    }
  }

  /**
   * Wake a waiting workflow when a matching event arrives.
   */
  async wakeWorkflow(
    id: string,
    eventContext: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    const result = await this.stateMachine.transition(id, 'waiting', 'running', {
      wokenAt: new Date().toISOString(),
      wakeEvent: eventContext,
    });

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to wake workflow: ${result.error}`);
    }

    return result.workflow;
  }

  /**
   * Handle timeout for a waiting workflow.
   */
  async handleTimeout(id: string): Promise<WorkflowInstance> {
    const result = await this.stateMachine.transition(id, 'waiting', 'failed', {
      timedOutAt: new Date().toISOString(),
      reason: 'Workflow timeout exceeded',
    });

    // Update error_message
    await this.pgClient.query(
      'UPDATE aos_workflow SET error_message = $1 WHERE id = $2',
      ['Workflow timeout exceeded', id],
    );

    if (!result.success || !result.workflow) {
      throw new Error(`Failed to handle timeout: ${result.error}`);
    }

    // Audit log for timeout
    if (this.audit) {
      await this.audit.log({
        id: crypto.randomUUID(),
        type: 'aos.workflow.timeout',
        actor: result.workflow!.agentId,
        payload: {
          workflowId: id,
          name: result.workflow!.name,
          waitedSince: result.workflow!.contextJson?.waitingSince,
        },
      });
    }

    return result.workflow;
  }
}
