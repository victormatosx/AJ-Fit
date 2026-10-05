import { describe, expect, it, vi } from 'vitest';

import {
  completeWorkoutSessionFlow,
  recoveryFinalizationMode,
  runWorkoutCompletionAttempt,
  runWorkoutCompletionFollowUp,
  workoutCompletionAllowsHome,
} from '../finishFlow';
import { WorkoutMutationQueue } from '../mutationQueue';
import type { PersistedWorkoutExecution } from '../../services/workoutExecutions';

function recoveredExecution(
  setStatuses: ('PENDING' | 'COMPLETED' | 'SKIPPED')[],
  cardio: PersistedWorkoutExecution['cardio'] = null,
): PersistedWorkoutExecution {
  return {
    exercises: [{
      exerciseIndex: 0,
      exerciseId: 'squat',
      sets: setStatuses.map((status, setIndex) => ({
        setIndex,
        status,
        weightKg: status === 'COMPLETED' ? 40 : null,
        actualReps: status === 'COMPLETED' ? 10 : null,
        actualDurationSeconds: null,
      })),
    }],
    cardio,
  } as PersistedWorkoutExecution;
}

describe('recovery finalization mode', () => {
  it('uses the live WorkoutScreen early-finish semantics when strength work remains', () => {
    expect(recoveryFinalizationMode(
      recoveredExecution(['COMPLETED', 'PENDING']),
      false,
    )).toBe('EARLY');
  });

  it('uses NORMAL when every strength set is settled and there is no cardio finisher', () => {
    expect(recoveryFinalizationMode(
      recoveredExecution(['COMPLETED', 'SKIPPED']),
      false,
    )).toBe('NORMAL');
  });

  it('uses EARLY to skip an unsettled cardio finisher and NORMAL once cardio is durable', () => {
    const strengthDone = recoveredExecution(['COMPLETED']);
    const cardioDone = recoveredExecution(['COMPLETED'], {
      status: 'COMPLETED',
      actualDurationSeconds: 600,
      completedAt: null,
    });
    expect(recoveryFinalizationMode(strengthDone, true)).toBe('EARLY');
    expect(recoveryFinalizationMode(cardioDone, true)).toBe('NORMAL');
  });

  it('preserves the original terminal mode when retrying after a lost response', () => {
    const terminal = {
      ...recoveredExecution(['COMPLETED', 'SKIPPED'], {
        status: 'SKIPPED',
        reason: 'EARLY_FINISH',
        skippedAt: null,
      }),
      status: 'PARTIALLY_COMPLETED',
      finalizationMode: 'EARLY',
    } as PersistedWorkoutExecution;
    expect(recoveryFinalizationMode(terminal, true)).toBe('EARLY');
  });
});

describe('Execution → Schedule integrity', () => {
  it('does not advance Schedule when finish fails', async () => {
    const completeSchedule = vi.fn(async () => true);
    await expect(completeWorkoutSessionFlow({
      finishExecution: async () => null,
      completeSchedule,
    })).resolves.toBe('EXECUTION_FAILED');
    expect(completeSchedule).not.toHaveBeenCalled();
  });

  it('advances Schedule exactly once after a successful finish', async () => {
    const completeSchedule = vi.fn(async () => true);
    await expect(completeWorkoutSessionFlow({
      finishExecution: async () => 'COMPLETED',
      completeSchedule,
    })).resolves.toBe('COMPLETED');
    expect(completeSchedule).toHaveBeenCalledTimes(1);
  });

  it('releases durable completion before the lifecycle follow-up settles', async () => {
    const finishExecution = vi.fn(async () => 'COMPLETED' as const);
    const completeSchedule = vi.fn(async () => true);
    let releaseLifecycle!: () => void;
    const lifecycleGate = new Promise<void>((resolve) => { releaseLifecycle = resolve; });
    const reconcileLifecycle = vi.fn(() => lifecycleGate);
    const refreshProjections = vi.fn(async () => undefined);

    const result = await completeWorkoutSessionFlow({ finishExecution, completeSchedule });
    expect(result).toBe('COMPLETED');
    expect(workoutCompletionAllowsHome(result)).toBe(true);

    const followUp = runWorkoutCompletionFollowUp({ reconcileLifecycle, refreshProjections });
    await Promise.resolve();
    expect(finishExecution).toHaveBeenCalledTimes(1);
    expect(completeSchedule).toHaveBeenCalledTimes(1);
    expect(reconcileLifecycle).toHaveBeenCalledTimes(1);
    expect(refreshProjections).not.toHaveBeenCalled();

    releaseLifecycle();
    await expect(followUp).resolves.toEqual({ lifecycle: 'COMPLETED', projections: 'COMPLETED' });
    expect(refreshProjections).toHaveBeenCalledTimes(1);
  });

  it('consumes a lifecycle failure and still refreshes projections without blocking Home', async () => {
    const onLifecycleFailure = vi.fn();
    const refreshProjections = vi.fn(async () => undefined);
    const outcome = await runWorkoutCompletionFollowUp({
      reconcileLifecycle: async () => { throw new Error('offline'); },
      refreshProjections,
      onLifecycleFailure,
    });

    expect(outcome).toEqual({ lifecycle: 'FAILED', projections: 'COMPLETED' });
    expect(onLifecycleFailure).toHaveBeenCalledTimes(1);
    expect(refreshProjections).toHaveBeenCalledTimes(1);
  });

  it.each(['evolution', 'activity', 'frequency'])('%s projection failure cannot undo durable completion', async () => {
    const onProjectionFailure = vi.fn();
    const outcome = await runWorkoutCompletionFollowUp({
      reconcileLifecycle: async () => undefined,
      refreshProjections: async () => { throw new Error('projection failed'); },
      onProjectionFailure,
    });

    expect(outcome).toEqual({ lifecycle: 'COMPLETED', projections: 'FAILED' });
    expect(onProjectionFailure).toHaveBeenCalledTimes(1);
  });

  it('reports a schedule failure only after Execution is already durable and retries idempotently', async () => {
    const finishExecution = vi.fn(async () => 'COMPLETED' as const);
    let scheduleAttempt = 0;
    const completeSchedule = vi.fn(async () => {
      scheduleAttempt += 1;
      return scheduleAttempt > 1;
    });

    await expect(completeWorkoutSessionFlow({ finishExecution, completeSchedule }))
      .resolves.toBe('SCHEDULE_FAILED');
    await expect(completeWorkoutSessionFlow({ finishExecution, completeSchedule }))
      .resolves.toBe('COMPLETED');
    expect(finishExecution).toHaveBeenCalledTimes(2);
    expect(completeSchedule).toHaveBeenCalledTimes(2);
  });

  it('offline EXECUTION_FAILED releases the attempt and reconnect retries the same execution to COMPLETED', async () => {
    const ref = { current: null as Promise<import('../finishFlow').WorkoutCompletionResult> | null };
    const executionId = 'execution-same';
    let online = false;
    const finishExecution = vi.fn(async () => online ? 'COMPLETED' as const : null);
    const completeSchedule = vi.fn(async () => true);
    const attempt = () => completeWorkoutSessionFlow({ finishExecution, completeSchedule });

    await expect(runWorkoutCompletionAttempt(ref, attempt)).resolves.toBe('EXECUTION_FAILED');
    expect(ref.current).toBeNull();
    online = true;
    await expect(runWorkoutCompletionAttempt(ref, attempt)).resolves.toBe('COMPLETED');
    expect(executionId).toBe('execution-same');
    expect(finishExecution).toHaveBeenCalledTimes(2);
  });

  it('terminal Execution plus failed Schedule retries only the same idempotent durable facts', async () => {
    const execution = { executionId: 'execution-terminal', status: 'IN_PROGRESS' as 'IN_PROGRESS' | 'COMPLETED' };
    let online = false;
    let executionCommits = 0;
    let scheduleEvents = 0;
    const createExecution = vi.fn();
    const finishExecution = vi.fn(async () => {
      if (execution.status !== 'COMPLETED') {
        execution.status = 'COMPLETED';
        executionCommits += 1;
      }
      return 'COMPLETED' as const;
    });
    const completeSchedule = vi.fn(async () => {
      if (!online) return false;
      if (scheduleEvents === 0) scheduleEvents += 1;
      return true;
    });

    await expect(completeWorkoutSessionFlow({ finishExecution, completeSchedule })).resolves.toBe('SCHEDULE_FAILED');
    online = true;
    await expect(completeWorkoutSessionFlow({ finishExecution, completeSchedule })).resolves.toBe('COMPLETED');
    expect(execution.executionId).toBe('execution-terminal');
    expect(executionCommits).toBe(1);
    expect(scheduleEvents).toBe(1);
    expect(createExecution).not.toHaveBeenCalled();
  });

  it('a lost response after both commits converges to idempotent success without duplicate effects', async () => {
    let executionDurable = false;
    let scheduleDurable = false;
    let executionEffects = 0;
    let scheduleEffects = 0;
    const finishExecution = vi.fn(async () => {
      if (!executionDurable) { executionDurable = true; executionEffects += 1; }
      return 'COMPLETED' as const;
    });
    const completeSchedule = vi.fn(async () => {
      if (!scheduleDurable) { scheduleDurable = true; scheduleEffects += 1; }
      return true;
    });

    // The first client response is considered lost after both durable calls.
    await completeWorkoutSessionFlow({ finishExecution, completeSchedule });
    await expect(completeWorkoutSessionFlow({ finishExecution, completeSchedule })).resolves.toBe('COMPLETED');
    expect({ executionEffects, scheduleEffects }).toEqual({ executionEffects: 1, scheduleEffects: 1 });
  });

  it.each([false, true])('retry remains valid with cardio already persisted: %s', async (cardioPersisted) => {
    let cardioEffects = cardioPersisted ? 1 : 0;
    const persistCardio = vi.fn(async () => {
      if (cardioEffects === 0) cardioEffects += 1;
    });
    if (cardioPersisted) await persistCardio();
    await completeWorkoutSessionFlow({
      finishExecution: async () => 'COMPLETED',
      completeSchedule: async () => true,
    });
    expect(cardioEffects).toBe(cardioPersisted ? 1 : 0);
  });
});

describe('workout completion attempt single-flight', () => {
  it('reuses one Promise during a double tap and clears it after success', async () => {
    const ref = { current: null as Promise<import('../finishFlow').WorkoutCompletionResult> | null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const task = vi.fn(async () => { await gate; return 'COMPLETED' as const; });
    const first = runWorkoutCompletionAttempt(ref, task);
    const second = runWorkoutCompletionAttempt(ref, task);
    expect(second).toBe(first);
    expect(task).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe('COMPLETED');
    expect(task).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it.each(['EXECUTION_FAILED', 'SCHEDULE_FAILED'] as const)('%s never leaves a settled Promise blocking retry', async (failure) => {
    const ref = { current: null as Promise<import('../finishFlow').WorkoutCompletionResult> | null };
    const task = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce('COMPLETED');
    await expect(runWorkoutCompletionAttempt(ref, task)).resolves.toBe(failure);
    expect(ref.current).toBeNull();
    await expect(runWorkoutCompletionAttempt(ref, task)).resolves.toBe('COMPLETED');
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('recordSet → finish barrier', () => {
  it('waits for multiple accepted writes before flush resolves', async () => {
    const queue = new WorkoutMutationQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    void queue.enqueue('set:0:0', async () => { await firstGate; order.push('first'); });
    void queue.enqueue('set:0:1', async () => { order.push('second'); });
    const flushing = queue.flush().then(() => order.push('finish'));
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    await flushing;
    expect(order).toEqual(['first', 'second', 'finish']);
  });

  it('blocks finish after a failed set and permits a successful deterministic retry', async () => {
    const queue = new WorkoutMutationQueue();
    await expect(queue.enqueue('set:0:0', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(queue.flush()).rejects.toThrow('WORKOUT_MUTATIONS_UNRECONCILED:set:0:0');
    await queue.enqueue('set:0:0', async () => undefined);
    await expect(queue.flush()).resolves.toBeUndefined();
  });

  it('reconciles a transiently failed accepted set at the finish barrier', async () => {
    const queue = new WorkoutMutationQueue();
    let attempt = 0;
    const operation = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient');
    };
    await expect(queue.enqueue('set:0:0', operation)).rejects.toThrow('transient');
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it('can discard a failed modal edit so cancel never replays it at finish', async () => {
    const queue = new WorkoutMutationQueue();
    let attempts = 0;
    await expect(queue.enqueue('set:0:0', async () => {
      attempts += 1;
      throw new Error('offline');
    })).rejects.toThrow('offline');

    queue.discardFailedMutation('set:0:0');
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(attempts).toBe(1);
  });

  it('retries a failed original set before a same-set edit', async () => {
    const queue = new WorkoutMutationQueue();
    const order: string[] = [];
    let attempt = 0;
    const record = async () => {
      attempt += 1;
      order.push(`record:${attempt}`);
      if (attempt === 1) throw new Error('offline');
    };
    await expect(queue.enqueue('set:0:0', record)).rejects.toThrow('offline');
    await expect(queue.retryFailedMutation('set:0:0')).resolves.toBe(true);
    await queue.enqueue('set:0:0:edit', async () => { order.push('edit'); });
    expect(order).toEqual(['record:1', 'record:2', 'edit']);
    await expect(queue.flush()).resolves.toBeUndefined();
  });

  it('keeps a permanent set failure as a finish blocker without retrying it', async () => {
    const queue = new WorkoutMutationQueue();
    let attempts = 0;
    const error = Object.assign(new Error('rules'), { code: 'permission-denied' });
    await expect(queue.enqueue('set:0:0', async () => {
      attempts += 1;
      throw error;
    })).rejects.toBe(error);
    queue.markFailedMutationPermanent('set:0:0', error);
    await expect(queue.retryFailedMutation('set:0:0')).rejects.toBe(error);
    await expect(queue.flush()).rejects.toThrow('WORKOUT_MUTATIONS_UNRECONCILED:set:0:0');
    expect(attempts).toBe(1);
  });
});
