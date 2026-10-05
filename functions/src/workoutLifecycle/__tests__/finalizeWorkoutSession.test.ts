import { describe, expect, it } from 'vitest';

import { completionFromCounts, writeFinalizationProgressBestEffort } from '../finalizeWorkoutSession';

describe('finalizeWorkoutSession completion facts', () => {
  it.each([
    [4, 10, 4000],
    [7, 10, 7000],
    [9, 10, 9000],
    [10, 10, 10000],
    [1, 3, 3333],
  ])('derives %i/%i deterministically in basis points', (completed, prescribed, expected) => {
    expect(completionFromCounts({ completed, prescribed })).toEqual({
      plannedSets: prescribed,
      completedSets: completed,
      percentageBasisPoints: expected,
    });
  });
});

describe('finalization progress sidecar', () => {
  it('never rejects the authoritative flow when a sidecar write fails', async () => {
    const failure = new Error('sidecar unavailable');
    const observed: unknown[] = [];
    await expect(writeFinalizationProgressBestEffort(
      async () => { throw failure; },
      (error) => observed.push(error),
    )).resolves.toBeUndefined();
    expect(observed).toEqual([failure]);
  });

  it('also absorbs a diagnostic callback failure', async () => {
    await expect(writeFinalizationProgressBestEffort(
      async () => { throw new Error('sidecar unavailable'); },
      () => { throw new Error('logger unavailable'); },
    )).resolves.toBeUndefined();
  });
});
