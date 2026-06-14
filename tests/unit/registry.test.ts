/**
 * Unit tests: WorkflowRegistry.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowRegistry } from '../../src/workflows/registry';
import type { WorkflowInstance } from '../../src/workflows/state-machine';

function makeWf(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: overrides.id ?? 'wf-001',
    agentId: 'hr-assistant',
    name: 'test-workflow',
    state: 'running',
    currentStep: null,
    contextJson: {},
    checkpoint: null,
    parentId: null,
    timeoutAt: null,
    errorMessage: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

describe('WorkflowRegistry', () => {
  it('registers a running workflow', () => {
    const registry = new WorkflowRegistry();
    registry.markRunning(makeWf({ id: 'wf-001' }));
    expect(registry.get('wf-001')).toBeDefined();
    expect(registry.activeCount).toBe(1);
  });

  it('suspends and marksDone', () => {
    const registry = new WorkflowRegistry();
    registry.markRunning(makeWf({ id: 'wf-001' }));
    registry.markSuspended(makeWf({ id: 'wf-001', state: 'suspended' }));
    expect(registry.get('wf-001')?.state).toBe('suspended');
    registry.markDone('wf-001');
    expect(registry.get('wf-001')).toBeUndefined();
  });

  it('lists active by agent', () => {
    const registry = new WorkflowRegistry();
    registry.markRunning(makeWf({ id: 'wf-001', agentId: 'hr-assistant' }));
    registry.markRunning(makeWf({ id: 'wf-002', agentId: 'finance-controller' }));
    expect(registry.listActive('hr-assistant')).toHaveLength(1);
    expect(registry.listActive()).toHaveLength(2);
  });

  it('update replaces in-place', () => {
    const registry = new WorkflowRegistry();
    registry.markRunning(makeWf({ id: 'wf-001', version: 1 }));
    registry.update(makeWf({ id: 'wf-001', version: 2 }));
    expect(registry.get('wf-001')?.version).toBe(2);
  });
});
