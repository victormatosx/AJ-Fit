import { describe, expect, it, vi } from 'vitest';

import {
  createWorkoutFinalizationProgressAttempt,
  runWorkoutFinalizationWithBestEffortProgress,
} from '../finalizationRuntime';
import { furthestWorkoutFinalizationStage, type WorkoutFinalizationProgressStage } from '../finalizationProgress';
import { runWorkoutCompletionAttempt, type WorkoutCompletionResult } from '../finishFlow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('best-effort workout finalization runtime', () => {
  it('still runs the authoritative finalizer when randomUUID throws', async () => {
    const finalizeWorkoutSession = vi.fn(async (attemptId: string | null) => {
      expect(attemptId).toBeNull();
      return 'COMPLETED' as const;
    });
    const stages: WorkoutFinalizationProgressStage[] = [];

    await expect(runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => { throw new Error('native crypto unavailable'); },
        subscribe: vi.fn(),
        onStage: (stage) => stages.push(stage),
      }),
      runAuthoritative: (attemptId) => finalizeWorkoutSession(attemptId),
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
    })).resolves.toBe('COMPLETED');

    expect(finalizeWorkoutSession).toHaveBeenCalledOnce();
    expect(stages).toEqual(['COMMITTED']);
  });

  it('supports an extremely fast callable and forces COMMITTED without a delay', async () => {
    const stages: WorkoutFinalizationProgressStage[] = [];
    await expect(runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => 'attempt-fast',
        onStage: (stage) => stages.push(stage),
      }),
      runAuthoritative: async (_attemptId, report) => {
        report('CLIENT_READY');
        return 'COMPLETED' as const;
      },
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
    })).resolves.toBe('COMPLETED');
    expect(stages).toEqual(['CLIENT_READY', 'COMMITTED']);
  });

  it('returns authoritative success even if the visual success classifier fails', async () => {
    const onInfrastructureError = vi.fn();
    await expect(runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => 'attempt-classifier',
        onStage: () => undefined,
      }),
      runAuthoritative: async () => 'COMPLETED' as const,
      isAuthoritativelyCommitted: () => { throw new Error('visual classifier failed'); },
      onInfrastructureError,
    })).resolves.toBe('COMPLETED');
    expect(onInfrastructureError).toHaveBeenCalledWith('VISUAL_PROGRESS', expect.any(Error));
  });

  it('isolates listener setup, visual callback and cleanup failures from the callable', async () => {
    const finalizer = vi.fn(async (
      _attemptId: string | null,
      report: (stage: WorkoutFinalizationProgressStage) => void,
    ) => {
      report('CLIENT_READY');
      return 'COMPLETED' as const;
    });
    const onInfrastructureError = vi.fn();

    await expect(runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => ({
        attemptId: 'attempt-broken-progress',
        reportCheckpoint: () => { throw new Error('visual progress failed'); },
        dispose: () => { throw new Error('listener cleanup failed'); },
      }),
      runAuthoritative: finalizer,
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
      onInfrastructureError,
    })).resolves.toBe('COMPLETED');

    expect(finalizer).toHaveBeenCalledOnce();
    expect(onInfrastructureError).toHaveBeenCalledWith('VISUAL_PROGRESS', expect.any(Error));
    expect(onInfrastructureError).toHaveBeenCalledWith('LISTENER_CLEANUP', expect.any(Error));
  });

  it('still runs the callable when the listener cannot be created', async () => {
    const finalizer = vi.fn(async () => 'COMPLETED' as const);
    await expect(runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => 'attempt-listener-failure',
        subscribe: () => { throw new Error('firestore listener unavailable'); },
        onStage: () => undefined,
      }),
      runAuthoritative: finalizer,
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
    })).resolves.toBe('COMPLETED');
    expect(finalizer).toHaveBeenCalledOnce();
  });

  it('keeps a slow callable pending even if the sidecar reports COMMITTED first', async () => {
    const callable = deferred<'COMPLETED'>();
    const sidecarStages: ((stage: WorkoutFinalizationProgressStage) => void)[] = [];
    let settled = false;
    const stages: WorkoutFinalizationProgressStage[] = [];
    const run = runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => 'attempt-slow',
        subscribe: (_attemptId, onStage) => {
          sidecarStages.push(onStage);
          return () => undefined;
        },
        onStage: (stage) => stages.push(stage),
      }),
      runAuthoritative: () => callable.promise,
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
    }).then((result) => { settled = true; return result; });

    sidecarStages[0]('COMMITTED');
    await Promise.resolve();
    expect(stages).toEqual(['COMMITTED']);
    expect(settled).toBe(false);

    callable.resolve('COMPLETED');
    await expect(run).resolves.toBe('COMPLETED');
  });

  it('ignores callbacks after dispose and lets a remounted attempt use a new id', () => {
    const callbacks: ((stage: WorkoutFinalizationProgressStage) => void)[] = [];
    let visibleStage: WorkoutFinalizationProgressStage = 'WAITING';
    const create = (attemptId: string) => createWorkoutFinalizationProgressAttempt({
      createAttemptId: () => attemptId,
      subscribe: (_id, onStage) => {
        callbacks.push(onStage);
        return () => undefined;
      },
      onStage: (stage) => { visibleStage = furthestWorkoutFinalizationStage(visibleStage, stage); },
    });

    const first = create('attempt-1');
    first.dispose();
    const second = create('attempt-2');
    callbacks[0]('COMMITTED');
    expect(visibleStage).toBe('WAITING');
    callbacks[1]('SERVER_ACCEPTED');
    expect(visibleStage).toBe('SERVER_ACCEPTED');
    expect(second.attemptId).toBe('attempt-2');
  });

  it('keeps concurrent retries single-flight and changes attempt id only after settlement', async () => {
    const ref = { current: null as Promise<WorkoutCompletionResult> | null };
    const first = deferred<WorkoutCompletionResult>();
    const ids = ['attempt-1', 'attempt-2'];
    const started: string[] = [];
    const task = () => runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => createWorkoutFinalizationProgressAttempt({
        createAttemptId: () => ids[started.length],
        onStage: () => undefined,
      }),
      runAuthoritative: async (attemptId) => {
        started.push(attemptId!);
        return started.length === 1 ? first.promise : 'COMPLETED';
      },
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED',
    });

    const one = runWorkoutCompletionAttempt(ref, task);
    const duplicate = runWorkoutCompletionAttempt(ref, task);
    expect(one).toBe(duplicate);
    await Promise.resolve();
    expect(started).toEqual(['attempt-1']);
    first.resolve('EXECUTION_FAILED');
    await expect(one).resolves.toBe('EXECUTION_FAILED');
    await Promise.resolve();
    await expect(runWorkoutCompletionAttempt(ref, task)).resolves.toBe('COMPLETED');
    expect(started).toEqual(['attempt-1', 'attempt-2']);
  });
});
