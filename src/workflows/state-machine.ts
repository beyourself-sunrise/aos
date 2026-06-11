/**
 * StateMachine — workflow state machine with optimistic locking.
 *
 * States: pending -> running -> waiting -> done/failed
 *
 * Transitions:
 * - pending -> running (start execution)
 * - running -> waiting (await async event)
 * - running -> done (complete synchronously)
 * - running -> failed (error)
 * - waiting -> running (wake from trigger)
 * - waiting -> failed (timeout)
 *
 * Uses optimistic locking via version column.
 */

import { Client as PgClient } from 'pg';
import type { Audit } from '../interfaces/audit';

/** Workflow states. */
export type WorkflowState = 'pending' | 'running' | 'waiting' | 'done' | 'failed';

/** Valid state transitions.
 *
 * `running -> running` is a self-transition used by `WorkflowRunner.runSyncStep`
 * to update `context_json` (current step, step result) while keeping the
 * workflow in the running state. The optimistic lock (`version`) still
 * increments, so concurrent updates remain safe.
 */
export const VALID_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  pending: ['running'],
  running: ['running', 'waiting', 'done', 'failed'],
  waiting: ['running', 'failed'],
  done: [],
  failed: [],
};

/** Workflow instance data. */
export interface WorkflowInstance {
  id: string;
  agentId: string;
  name: string;
  state: WorkflowState;
  currentStep: string | null;
  contextJson: Record<string, unknown>;
  timeoutAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Transition result. */
export interface TransitionResult {
  success: boolean;
  workflow: WorkflowInstance | null;
  error?: string;
}

/**
 * StateMachine — manages workflow state transitions with optimistic locking.
 */
export class StateMachine {
  constructor(
    private pgClient: PgClient,
    private audit?: Audit,
  ) {}

  /**
   * Transition a workflow from one state to another.
   * Uses optimistic locking: SELECT FOR UPDATE + version check.
   */
  async transition(
    id: string,
    fromState: WorkflowState,
    toState: WorkflowState,
    contextUpdate?: Record<string, unknown>,
  ): Promise<TransitionResult> {
    // Validate transition
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed.includes(toState)) {
      return {
        success: false,
        workflow: null,
        error: `Invalid transition: ${fromState} -> ${toState} (allowed: ${allowed.join(', ')})`,
      };
    }

    try {
      // Lock the workflow row
      const result = await this.pgClient.query(
        'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
          'FROM aos_workflow WHERE id = $1 FOR UPDATE',
        [id],
      );

      if (result.rows.length === 0) {
        return { success: false, workflow: null, error: `Workflow not found: ${id}` };
      }

      const row = result.rows[0];
      const currentVersion = row.version as number;

      // Check current state matches expected
      if (row.state !== fromState) {
        return {
          success: false,
          workflow: null,
          error: `State mismatch: expected ${fromState}, got ${row.state}`,
        };
      }

      // Merge context update
      const newContext = {
        ...row.context_json,
        ...(contextUpdate ?? {}),
        lastTransition: {
          from: fromState,
          to: toState,
          at: new Date().toISOString(),
        },
      };

      // Atomic update with version check
      const updateResult = await this.pgClient.query(
        'UPDATE aos_workflow SET state = $1, context_json = $2, version = version + 1, updated_at = NOW() ' +
          'WHERE id = $3 AND version = $4',
        [toState, JSON.stringify(newContext), id, currentVersion],
      );

      if (updateResult.rowCount === 0) {
        return {
          success: false,
          workflow: null,
          error: 'Optimistic lock conflict: workflow was modified by another process',
        };
      }

      // Read back updated row
      const updatedResult = await this.pgClient.query(
        'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
          'FROM aos_workflow WHERE id = $1',
        [id],
      );

      const workflow = this.rowToInstance(updatedResult.rows[0]);

      // Audit log
      if (this.audit) {
        await this.audit.log({
          id: crypto.randomUUID(),
          type: 'aos.workflow.transitioned',
          actor: workflow.agentId,
          payload: {
            workflowId: id,
            fromState,
            toState,
            version: workflow.version,
          },
        });
      }

      return { success: true, workflow };
    } catch (err) {
      return {
        success: false,
        workflow: null,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Get a workflow instance by ID.
   */
  async get(id: string): Promise<WorkflowInstance | null> {
    const result = await this.pgClient.query(
      'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
        'FROM aos_workflow WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) return null;
    return this.rowToInstance(result.rows[0]);
  }

  /**
   * List workflows by agent and state.
   */
  async listByAgent(agentId: string, state?: WorkflowState): Promise<WorkflowInstance[]> {
    let query =
      'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
      'FROM aos_workflow WHERE agent_id = $1';
    const params: unknown[] = [agentId];

    if (state) {
      query += ' AND state = $2';
      params.push(state);
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.pgClient.query(query, params);
    return result.rows.map((row) => this.rowToInstance(row));
  }

  /**
   * Find expired waiting workflows (timeout).
   */
  async findExpired(): Promise<WorkflowInstance[]> {
    const result = await this.pgClient.query(
      'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
        'FROM aos_workflow WHERE state = \'waiting\' AND timeout_at < NOW()',
    );

    return result.rows.map((row) => this.rowToInstance(row));
  }

  /**
   * Find waiting workflows matching a wakeOn condition.
   */
  async findWaitingByWakeOn(wakeOn: Record<string, unknown>): Promise<WorkflowInstance[]> {
    // Search for workflows whose context_json contains matching wakeOn
    const wakeOnJson = JSON.stringify(wakeOn);
    const result = await this.pgClient.query(
      'SELECT id, agent_id, name, state, current_step, context_json, timeout_at, error_message, created_at, updated_at, version ' +
        'FROM aos_workflow WHERE state = \'waiting\' AND context_json->\'wakeOn\' IS NOT NULL',
    );

    // Filter by wakeOn match in application layer
    return result.rows
      .map((row) => this.rowToInstance(row))
      .filter((w) => this.matchesWakeOn(w, wakeOn));
  }

  /**
   * Check if a workflow's wakeOn matches the given event.
   */
  private matchesWakeOn(workflow: WorkflowInstance, event: Record<string, unknown>): boolean {
    const wakeOn = workflow.contextJson?.wakeOn as Record<string, unknown> | undefined;
    if (!wakeOn) return false;

    for (const [key, value] of Object.entries(wakeOn)) {
      if (value !== undefined && event[key] !== value) {
        // Wildcard: if wakeOn value is '*', it matches anything
        if (value !== '*') return false;
      }
    }
    return true;
  }

  /** Convert DB row to WorkflowInstance. */
  private rowToInstance(row: Record<string, unknown>): WorkflowInstance {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      name: row.name as string,
      state: row.state as WorkflowState,
      currentStep: row.current_step as string | null,
      contextJson: row.context_json as Record<string, unknown>,
      timeoutAt: row.timeout_at as Date | null,
      errorMessage: row.error_message as string | null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      version: row.version as number,
    };
  }
}
