import { describe, expect, it, vi } from 'vitest';

import type { PersistedWorkoutExecution } from '../../services/workoutExecutions';
import {
  loadAuthoritativelyCommittedFinalization,
  resolveAuthoritativeCardioFinisherPresence,
} from '../finalizationRecovery';

function execution(status: PersistedWorkoutExecution['status'], withCompletion = true): PersistedWorkoutExecution {
  return {
    executionId: 'exec_1',
    programId: 'program_1',
    programInstanceId: 'instance_1',
    templateId: 'template_1',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-10-04',
    performedLocalDate: '2026-10-04',
    status,
    startedAt: null as never,
    finishedAt: null,
    exercises: [],
    cardio: null,
    ...(withCompletion ? { completion: { plannedSets: 3, completedSets: 3, percentageBasisPoints: 10_000 } } : {}),
    executionSchemaVersion: 1,
    createdAt: null as never,
    updatedAt: null as never,
    timestampAuthority: 'SERVER',
  };
}

describe('ambiguous finalization response recovery', () => {
  it('accepts a lost response only when execution and deterministic event are both durable', async () => {
    const terminal = execution('COMPLETED');
    const loadExecution = vi.fn(async () => terminal);
    const hasCompletionEvent = vi.fn(async () => true);
    await expect(loadAuthoritativelyCommittedFinalization({
      executionId: terminal.executionId,
      loadExecution,
      hasCompletionEvent,
    })).resolves.toBe(terminal);
    expect(hasCompletionEvent).toHaveBeenCalledWith(terminal);
  });

  it.each([
    ['execution still in progress', execution('IN_PROGRESS'), true],
    ['terminal execution has no completion facts', execution('COMPLETED', false), true],
    ['deterministic event is missing', execution('PARTIALLY_COMPLETED'), false],
  ])('fails closed when %s', async (_label, candidate, eventExists) => {
    await expect(loadAuthoritativelyCommittedFinalization({
      executionId: candidate.executionId,
      loadExecution: async () => candidate,
      hasCompletionEvent: async () => eventExists,
    })).resolves.toBeNull();
  });
});

describe('resolveAuthoritativeCardioFinisherPresence', () => {
  it('returns true when the authoritative session has a cardio finisher', async () => {
    const loadProgram = vi.fn(async () => ({
      sessions: [{ cardioFinisher: undefined }, { cardioFinisher: { duration: '10min' } }],
    }));
    await expect(resolveAuthoritativeCardioFinisherPresence({
      programId: 'program_1', sessionIndex: 1, loadProgram,
    })).resolves.toBe(true);
    expect(loadProgram).toHaveBeenCalledWith('program_1');
  });

  it('returns false when the authoritative session genuinely has no cardio finisher', async () => {
    const loadProgram = vi.fn(async () => ({ sessions: [{ cardioFinisher: undefined }] }));
    await expect(resolveAuthoritativeCardioFinisherPresence({
      programId: 'program_1', sessionIndex: 0, loadProgram,
    })).resolves.toBe(false);
  });

  it('returns null (unknown), never false, when the program document is missing', async () => {
    await expect(resolveAuthoritativeCardioFinisherPresence({
      programId: 'program_missing', sessionIndex: 0, loadProgram: async () => null,
    })).resolves.toBeNull();
  });

  it('returns null (unknown), never false, when sessionIndex is out of range', async () => {
    const loadProgram = async () => ({ sessions: [{ cardioFinisher: undefined }] });
    await expect(resolveAuthoritativeCardioFinisherPresence({
      programId: 'program_1', sessionIndex: 5, loadProgram,
    })).resolves.toBeNull();
  });

  it('returns null (unknown), never false, when the read throws', async () => {
    await expect(resolveAuthoritativeCardioFinisherPresence({
      programId: 'program_1',
      sessionIndex: 0,
      loadProgram: async () => { throw new Error('offline'); },
    })).resolves.toBeNull();
  });
});
