import { describe, expect, it } from 'vitest';

import { formatWorkoutLoadFromKg } from '../../units/workoutLoadConversions';
import {
  derivePreviousExerciseRecords,
  type ExerciseLoadProgress,
} from '../loadProgress';

function history(
  exerciseId: string,
  points: Array<[executionId: string, loadKg: number]>,
): ExerciseLoadProgress {
  return {
    exerciseId,
    history: points.map(([executionId, loadKg], index) => ({
      executionId,
      loadKg,
      localDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
    })),
  };
}

describe('derivePreviousExerciseRecords', () => {
  it('returns the highest valid load ever recorded, not the most recent one', () => {
    expect(derivePreviousExerciseRecords([
      history('bench', [['older-heavy', 65], ['latest-lighter', 60]]),
    ], 'current')).toEqual({ bench: 65 });
  });

  it('omits an exercise without history instead of inventing zero', () => {
    const result = derivePreviousExerciseRecords([], 'current');
    expect(result.squat).toBeUndefined();
    expect(Object.values(result)).not.toContain(0);
  });

  it('never counts the active execution toward the record', () => {
    expect(derivePreviousExerciseRecords([
      history('bench', [['previous', 60], ['current', 70]]),
    ], 'current')).toEqual({ bench: 60 });

    expect(derivePreviousExerciseRecords([
      history('row', [['current', 50]]),
    ], 'current')).toEqual({});
  });

  it('keeps the record by exercise id across a new program/cycle execution', () => {
    expect(derivePreviousExerciseRecords([
      history('deadlift', [['old-program-execution', 120]]),
    ], 'new-program-execution')).toEqual({ deadlift: 120 });
  });

  it('lets a substituted exercise use only its own effective exercise id', () => {
    const result = derivePreviousExerciseRecords([
      history('barbell-bench', [['old-a', 80]]),
      history('machine-bench', [['old-b', 55], ['old-c', 62]]),
    ], 'current');

    expect(result['machine-bench']).toBe(62);
    expect(result['machine-bench']).not.toBe(result['barbell-bench']);
  });

  it('leaves kg canonical and uses the existing kg/lb formatter for display', () => {
    const kg = derivePreviousExerciseRecords([
      history('bench', [['previous', 10]]),
    ], 'current').bench!;

    expect(formatWorkoutLoadFromKg(kg, 'metric')).toBe('10');
    expect(formatWorkoutLoadFromKg(kg, 'imperial')).toBe('22');
  });

  it('degrades to no record when history is absent after a load error', () => {
    expect(() => derivePreviousExerciseRecords([], 'current')).not.toThrow();
    expect(derivePreviousExerciseRecords([], 'current')).toEqual({});
  });

  it('ignores non-positive/invalid points defensively', () => {
    expect(derivePreviousExerciseRecords([
      history('bench', [['valid', 50], ['zero', 0], ['nan', Number.NaN]]),
    ], 'current')).toEqual({ bench: 50 });
  });
});
