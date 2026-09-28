import { describe, expect, it } from 'vitest';

import { formatWorkoutLoadFromKg } from '../../units/workoutLoadConversions';
import {
  derivePreviousExerciseSetLoads,
  type ExerciseCompletedSetHistory,
} from '../loadProgress';

function history(
  exerciseId: string,
  points: Array<[executionId: string, setLoadsKg: (number | null)[]]>,
): ExerciseCompletedSetHistory {
  return {
    exerciseId,
    history: points.map(([executionId, setLoadsKg], index) => ({
      executionId,
      setLoadsKg,
      localDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
    })),
  };
}

describe('derivePreviousExerciseSetLoads', () => {
  it('returns the previous workout with different weights per set, index-aligned', () => {
    expect(derivePreviousExerciseSetLoads([
      history('bench', [['previous', [55, 60, 60]]]),
    ], 'current')).toEqual({ bench: [55, 60, 60] });
  });

  it('lets a set show the historical weight of the same setIndex', () => {
    const previous = derivePreviousExerciseSetLoads([
      history('bench', [['previous', [55, 60, 60]]]),
    ], 'current');

    expect(previous.bench?.[0]).toBe(55);
    expect(previous.bench?.[1]).toBe(60);
    expect(previous.bench?.[2]).toBe(60);
  });

  it('leaves a set without a historical counterpart as null (renders "—")', () => {
    const previous = derivePreviousExerciseSetLoads([
      history('bench', [['previous', [55, null]]]),
    ], 'current');

    expect(previous.bench?.[1]).toBeNull();
    expect(previous.squat).toBeUndefined();
  });

  it('never uses the active execution as "previous workout"', () => {
    expect(derivePreviousExerciseSetLoads([
      history('bench', [['previous', [55, 60]], ['current', [70, 75]]]),
    ], 'current')).toEqual({ bench: [55, 60] });
  });

  it('falls back to an earlier COMPLETED execution when the latest one is the active one', () => {
    expect(derivePreviousExerciseSetLoads([
      history('bench', [['older', [50, 52]], ['current', [70, 75]]]),
    ], 'current')).toEqual({ bench: [50, 52] });
  });

  it('lets a substituted exercise use only its own effective exercise id', () => {
    const result = derivePreviousExerciseSetLoads([
      history('barbell-bench', [['old-a', [80, 80]]]),
      history('machine-bench', [['old-b', [55, 57]]]),
    ], 'current');

    expect(result['machine-bench']).toEqual([55, 57]);
    expect(result['machine-bench']).not.toEqual(result['barbell-bench']);
  });

  it('keeps history by exercise id across a new program/cycle execution', () => {
    expect(derivePreviousExerciseSetLoads([
      history('deadlift', [['old-program-execution', [120, 120]]]),
    ], 'new-program-execution')).toEqual({ deadlift: [120, 120] });
  });

  it('leaves kg canonical and uses the existing kg/lb formatter for display', () => {
    const kg = derivePreviousExerciseSetLoads([
      history('bench', [['previous', [10]]]),
    ], 'current').bench![0]!;

    expect(formatWorkoutLoadFromKg(kg, 'metric')).toBe('10');
    expect(formatWorkoutLoadFromKg(kg, 'imperial')).toBe('22');
  });

  it('degrades to no reference when history is absent after a load error', () => {
    expect(() => derivePreviousExerciseSetLoads([], 'current')).not.toThrow();
    expect(derivePreviousExerciseSetLoads([], 'current')).toEqual({});
  });
});
