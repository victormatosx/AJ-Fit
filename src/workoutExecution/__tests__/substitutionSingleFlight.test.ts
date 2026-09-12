import { describe, expect, it, vi } from 'vitest';

import {
  beginSubstitutionFlight,
  commitConfirmedSubstitution,
  type ConfirmedSubstitutions,
  type SubstitutionFlightRef,
} from '../substitutionSingleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('exercise substitution UI single-flight', () => {
  it('commits SESSION and PERMANENT only after authoritative success', () => {
    const session = commitConfirmedSubstitution({}, {
      exerciseIndex: 0,
      prescribedExerciseId: 'anchor',
      requestedExerciseId: 'replacement-a',
      scope: 'SESSION',
    });
    const permanent = commitConfirmedSubstitution(session, {
      exerciseIndex: 1,
      prescribedExerciseId: 'other-anchor',
      requestedExerciseId: 'replacement-b',
      scope: 'PERMANENT',
    });

    expect(permanent).toEqual({
      0: { exerciseId: 'replacement-a', scope: 'SESSION' },
      1: { exerciseId: 'replacement-b', scope: 'PERMANENT' },
    });
  });

  it('turns a same-tick double tap into exactly one operation', async () => {
    const pending = deferred<string>();
    const task = vi.fn(() => pending.promise);
    const ref: SubstitutionFlightRef<string> = { current: null };

    const first = beginSubstitutionFlight(ref, task);
    const second = beginSubstitutionFlight(ref, task);
    pending.resolve('ok');

    expect(first.kind).toBe('started');
    expect(second.kind).toBe('reused');
    expect(second.promise).toBe(first.promise);
    await expect(first.promise).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('rejects every additional tap while pending, including a conflicting request', async () => {
    const pending = deferred<void>();
    const firstTask = vi.fn(() => pending.promise);
    const conflictingTask = vi.fn(async () => undefined);
    const ref: SubstitutionFlightRef<void> = { current: null };

    const first = beginSubstitutionFlight(ref, firstTask);
    for (let tap = 0; tap < 5; tap += 1) beginSubstitutionFlight(ref, conflictingTask);
    pending.resolve();
    await first.promise;

    expect(firstTask).toHaveBeenCalledTimes(1);
    expect(conflictingTask).not.toHaveBeenCalled();
  });

  it('survives a re-render because the stable ref retains the active flight', async () => {
    const pending = deferred<number>();
    const task = vi.fn(() => pending.promise);
    const stableRef: SubstitutionFlightRef<number> = { current: null };

    const beforeRender = beginSubstitutionFlight(stableRef, task);
    const afterRender = beginSubstitutionFlight(stableRef, task);
    pending.resolve(1);
    await beforeRender.promise;

    expect(afterRender.kind).toBe('reused');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('clears the flight on failure, preserves UI state, and permits retry', async () => {
    const previous: ConfirmedSubstitutions = {
      0: { exerciseId: 'previous', scope: 'SESSION' },
    };
    const firstTask = vi.fn(async () => { throw new Error('offline'); });
    const retryTask = vi.fn(async () => 'ok');
    const ref: SubstitutionFlightRef<string> = { current: null };

    await expect(beginSubstitutionFlight(ref, firstTask).promise).rejects.toThrow('offline');
    expect(ref.current).toBeNull();
    // The commit helper is deliberately not part of the failed path.
    expect(previous).toEqual({ 0: { exerciseId: 'previous', scope: 'SESSION' } });
    await expect(beginSubstitutionFlight(ref, retryTask).promise).resolves.toBe('ok');
    expect(retryTask).toHaveBeenCalledTimes(1);
  });

  it('revert removes only the effective override and leaves the prescribed anchor external', () => {
    const current: ConfirmedSubstitutions = {
      0: { exerciseId: 'replacement', scope: 'PERMANENT' },
      1: { exerciseId: 'unrelated', scope: 'SESSION' },
    };
    const prescribedExerciseId = 'anchor';

    expect(commitConfirmedSubstitution(current, {
      exerciseIndex: 0,
      prescribedExerciseId,
      requestedExerciseId: prescribedExerciseId,
      scope: 'SESSION',
    })).toEqual({ 1: { exerciseId: 'unrelated', scope: 'SESSION' } });
    expect(prescribedExerciseId).toBe('anchor');
  });
});
