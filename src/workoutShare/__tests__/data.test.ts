import { describe, expect, it } from 'vitest';

import {
  buildWorkoutShareBodyMap,
  buildWorkoutShareData,
  countCompletedExecutionSets,
  formatWorkoutShareDuration,
} from '../data';

const execution = {
  exercises: [
    { exerciseId: 'unknown-exercise-a', sets: [{ status: 'COMPLETED' }, { status: 'SKIPPED' }, { status: 'PENDING' }] },
    { exerciseId: 'unknown-exercise-b', sets: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }, { status: 'SKIPPED' }] },
    { exerciseId: 'unknown-exercise-c', sets: [{ status: 'SKIPPED' }, { status: 'SKIPPED' }] },
  ],
} as never;

describe('workout share data', () => {
  it('counts only persisted COMPLETED sets, never SKIPPED progress', () => {
    expect(countCompletedExecutionSets(execution)).toBe(3);
  });

  it('reports performed exercises instead of the full plan count for a partial session', () => {
    expect(buildWorkoutShareData({
      workoutName: 'Peito + Tríceps',
      exerciseCount: 7,
      execution,
      durationSeconds: 3_499.9,
    })).toEqual({
      workoutName: 'Peito + Tríceps',
      exerciseCount: 2,
      completedSetCount: 3,
      durationSeconds: 3_499,
      bodyMap: { primary: [], secondary: [] },
    });
  });

  it('formats the existing elapsed-seconds semantic without adding metrics', () => {
    expect(formatWorkoutShareDuration(3_499)).toBe('58 min');
    expect(formatWorkoutShareDuration(3_900)).toBe('1h 5min');
  });
});

describe('buildWorkoutShareBodyMap', () => {
  it('derives muscles only from exercises with at least one COMPLETED set', () => {
    const mixed = {
      exercises: [
        // Fully skipped — never performed, must not contribute a muscle.
        { exerciseId: 'lat-pulldown', sets: [{ status: 'SKIPPED' }, { status: 'PENDING' }] },
        // At least one completed set — counts as performed.
        { exerciseId: 'incline-dumbbell-bench-press', sets: [{ status: 'COMPLETED' }, { status: 'SKIPPED' }] },
      ],
    } as never;

    const result = buildWorkoutShareBodyMap(mixed);
    expect(result.primary).toEqual(['chest']);
    expect(result.primary).not.toContain('lats');
  });

  it('returns an empty breakdown instead of inventing muscles for a missing/null execution', () => {
    expect(buildWorkoutShareBodyMap(null)).toEqual({ primary: [], secondary: [] });
    expect(buildWorkoutShareBodyMap(undefined)).toEqual({ primary: [], secondary: [] });
  });

  it('skips exercise ids the bundled catalog does not recognize, without throwing', () => {
    const execution = {
      exercises: [{ exerciseId: 'not-a-real-exercise-id', sets: [{ status: 'COMPLETED' }] }],
    } as never;
    expect(buildWorkoutShareBodyMap(execution)).toEqual({ primary: [], secondary: [] });
  });
});
