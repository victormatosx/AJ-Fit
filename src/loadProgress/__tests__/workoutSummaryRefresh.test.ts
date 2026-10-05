import { describe, expect, it, vi } from 'vitest';

import type { PersistedWorkoutExecution } from '../../services/workoutExecutions';
import { executeWorkoutSummaryRefresh } from '../workoutSummaryRefresh';

function terminalExecution(): PersistedWorkoutExecution {
  return {
    executionId: 'execution-1',
    programId: 'program-1',
    programInstanceId: 'instance-1',
    templateId: 'template-1',
    sessionIndex: 0,
    sessionName: 'A',
    scheduledLocalDate: '2026-10-05',
    performedLocalDate: '2026-10-05',
    status: 'COMPLETED',
    startedAt: null as never,
    finishedAt: null,
    exercises: [],
    cardio: null,
    completion: { plannedSets: 3, completedSets: 3, percentageBasisPoints: 10_000 },
    executionSchemaVersion: 1,
    createdAt: null as never,
    updatedAt: null as never,
    timestampAuthority: 'SERVER',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('post-commit LoadProgress freshness', () => {
  it('does not publish stale PR data while the real refresh is pending', async () => {
    const read = deferred<PersistedWorkoutExecution | null>();
    const onFreshExecution = vi.fn();
    const onReady = vi.fn();
    const run = executeWorkoutSummaryRefresh({
      executionId: 'execution-1',
      loadExecution: () => read.promise,
      isCurrent: () => true,
      onFreshExecution,
      onReady,
      onError: vi.fn(),
    });

    await Promise.resolve();
    expect(onFreshExecution).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    read.resolve(terminalExecution());
    await expect(run).resolves.toBe('READY');
  });

  it('publishes the terminal snapshot before marking PR data ready', async () => {
    const order: string[] = [];
    await expect(executeWorkoutSummaryRefresh({
      executionId: 'execution-1',
      loadExecution: async () => terminalExecution(),
      isCurrent: () => true,
      onFreshExecution: () => order.push('fresh'),
      onReady: () => order.push('ready'),
      onError: () => order.push('error'),
    })).resolves.toBe('READY');
    expect(order).toEqual(['fresh', 'ready']);
  });

  it('moves to an explicit error state when the refresh fails', async () => {
    const failure = new Error('offline');
    const onError = vi.fn();
    await expect(executeWorkoutSummaryRefresh({
      executionId: 'execution-1',
      loadExecution: async () => { throw failure; },
      isCurrent: () => true,
      onFreshExecution: vi.fn(),
      onReady: vi.fn(),
      onError,
    })).resolves.toBe('ERROR');
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('handles an extremely fast refresh without exposing a stale intermediate result', async () => {
    const order: string[] = [];
    const result = await executeWorkoutSummaryRefresh({
      executionId: 'execution-1',
      loadExecution: async () => terminalExecution(),
      isCurrent: () => true,
      onFreshExecution: () => order.push('fresh'),
      onReady: () => order.push('ready'),
      onError: () => order.push('error'),
    });
    expect(result).toBe('READY');
    expect(order).toEqual(['fresh', 'ready']);
  });

  it('does not publish after unmount or a superseding request', async () => {
    const read = deferred<PersistedWorkoutExecution | null>();
    let current = true;
    const onFreshExecution = vi.fn();
    const onReady = vi.fn();
    const onError = vi.fn();
    const run = executeWorkoutSummaryRefresh({
      executionId: 'execution-1',
      loadExecution: () => read.promise,
      isCurrent: () => current,
      onFreshExecution,
      onReady,
      onError,
    });
    current = false;
    read.resolve(terminalExecution());
    await expect(run).resolves.toBe('CANCELLED');
    expect(onFreshExecution).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
