/**
 * WorkflowRegistry — in-memory registry of active workflows.
 *
 * Rehydrates from PG on startup. Each workflow lifecycle method
 * (suspend/resume/cancel/complete/fail) updates the registry
 * synchronously so in-memory queries are always consistent.
 */
import { StateMachine, WorkflowInstance, WorkflowState } from './state-machine';

export class WorkflowRegistry {
  /** In-memory map: workflowId → instance snapshot. */
  private workflows = new Map<string, WorkflowInstance>();

  /**
   * Rehydrate the registry from PG (called on AOS startup).
   */
  static async rehydrate(sm: StateMachine, agentId?: string): Promise<WorkflowRegistry> {
    const registry = new WorkflowRegistry();
    const active = await sm.findActive(agentId);
    for (const w of active) {
      registry.workflows.set(w.id, w);
    }
    return registry;
  }

  /** Register a workflow as running (entry point on start). */
  markRunning(w: WorkflowInstance): void {
    this.workflows.set(w.id, this.snapshot(w, 'running'));
  }

  /** Mark a workflow as suspended. */
  markSuspended(w: WorkflowInstance): void {
    this.workflows.set(w.id, this.snapshot(w, 'suspended'));
  }

  /** Mark a workflow as waiting. */
  markWaiting(w: WorkflowInstance): void {
    this.workflows.set(w.id, this.snapshot(w, 'waiting'));
  }

  /** Remove a workflow from the registry (done/failed/cancelled). */
  markDone(id: string): void {
    this.workflows.delete(id);
  }

  /** Get a workflow by id (may be stale; prefer PG for latest). */
  get(id: string): WorkflowInstance | undefined {
    return this.workflows.get(id);
  }

  /** List active workflows, optionally filtered by agent. */
  listActive(agentId?: string): WorkflowInstance[] {
    const all = Array.from(this.workflows.values());
    if (!agentId) return all;
    return all.filter((w) => w.agentId === agentId);
  }

  /** Count active workflows. */
  get activeCount(): number {
    return this.workflows.size;
  }

  /** Update registry entry in-place (for state changes). */
  update(w: WorkflowInstance): void {
    this.workflows.set(w.id, w);
  }

  private snapshot(w: WorkflowInstance, state: WorkflowState): WorkflowInstance {
    return { ...w, state, updatedAt: new Date() };
  }
}
