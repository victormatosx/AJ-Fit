import { describe, expect, it } from 'vitest';

import { completionFromCounts } from '../finalizeWorkoutSession';

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
