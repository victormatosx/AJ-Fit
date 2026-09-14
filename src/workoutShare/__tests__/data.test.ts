import { describe, expect, it } from 'vitest';

import { buildWorkoutShareData, countCompletedExecutionSets, formatWorkoutShareDuration } from '../data';

const execution = {
  exercises: [
    { sets: [{ status: 'COMPLETED' }, { status: 'SKIPPED' }, { status: 'PENDING' }] },
    { sets: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }, { status: 'SKIPPED' }] },
  ],
} as never;

describe('workout share data', () => {
  it('counts only persisted COMPLETED sets, never SKIPPED progress', () => {
    expect(countCompletedExecutionSets(execution)).toBe(3);
  });

  it('keeps the completed session name, exercise count and elapsed duration', () => {
    expect(buildWorkoutShareData({
      workoutName: 'Peito + Tríceps',
      exerciseCount: 7,
      execution,
      durationSeconds: 3_499.9,
    })).toEqual({
      workoutName: 'Peito + Tríceps',
      exerciseCount: 7,
      completedSetCount: 3,
      durationSeconds: 3_499,
    });
  });

  it('formats the existing elapsed-seconds semantic without adding metrics', () => {
    expect(formatWorkoutShareDuration(3_499)).toBe('58 min');
    expect(formatWorkoutShareDuration(3_900)).toBe('1h 5min');
  });
});
