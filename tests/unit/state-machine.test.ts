/**
 * Unit tests: StateMachine suspend/cancel transitions.
 */
import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS, WorkflowState } from '../../src/workflows/state-machine';

describe('StateMachine - VALID_TRANSITIONS (P2)', () => {
  it('allows running -> suspended', () => {
    expect(VALID_TRANSITIONS['running']).toContain('suspended');
  });

  it('allows suspended -> running', () => {
    expect(VALID_TRANSITIONS['suspended']).toContain('running');
  });

  it('allows suspended -> cancelled', () => {
    expect(VALID_TRANSITIONS['suspended']).toContain('cancelled');
  });

  it('allows running -> cancelled', () => {
    expect(VALID_TRANSITIONS['running']).toContain('cancelled');
  });

  it('allows waiting -> cancelled', () => {
    expect(VALID_TRANSITIONS['waiting']).toContain('cancelled');
  });

  it('allows pending -> cancelled', () => {
    expect(VALID_TRANSITIONS['pending']).toContain('cancelled');
  });

  it('cancelled has no outbound transitions', () => {
    expect(VALID_TRANSITIONS['cancelled']).toEqual([]);
  });

  it('done has no outbound transitions', () => {
    expect(VALID_TRANSITIONS['done']).toEqual([]);
  });

  it('running -> running self-transition persists', () => {
    expect(VALID_TRANSITIONS['running']).toContain('running');
  });

  it('workflow states cover all 7 states', () => {
    const allStates: WorkflowState[] = [
      'pending', 'running', 'waiting', 'suspended', 'done', 'failed', 'cancelled',
    ];
    for (const s of allStates) {
      expect(VALID_TRANSITIONS[s]).toBeDefined();
    }
  });
});
