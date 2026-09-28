import { describe, expect, it } from 'vitest';

import { formatWorkoutLoadFromKg } from '../../units/workoutLoadConversions';
import {
  derivePreviousExerciseLastLoad,
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

describe('derivePreviousExerciseLastLoad — fallback for the "next set" card', () => {
  it('returns the most recent valid load, not the best ever', () => {
    expect(derivePreviousExerciseLastLoad([
      history('bench', [['heaviest-older', 90], ['latest-lighter', 70]]),
    ], 'current')).toEqual({ bench: 70 });
  });

  it('omits an exercise without history instead of inventing zero', () => {
    const result = derivePreviousExerciseLastLoad([], 'current');
    expect(result.squat).toBeUndefined();
    expect(Object.values(result)).not.toContain(0);
  });

  it('never uses the active execution', () => {
    expect(derivePreviousExerciseLastLoad([
      history('bench', [['previous', 60], ['current', 70]]),
    ], 'current')).toEqual({ bench: 60 });

    expect(derivePreviousExerciseLastLoad([
      history('row', [['current', 50]]),
    ], 'current')).toEqual({});
  });

  it('keeps history by exercise id across a new program/cycle execution', () => {
    expect(derivePreviousExerciseLastLoad([
      history('deadlift', [['old-program-execution', 120]]),
    ], 'new-program-execution')).toEqual({ deadlift: 120 });
  });

  it('never falls back to the all-time record — only the most recent valid load', () => {
    // Heaviest set ever was 90kg two workouts ago; the most recent workout
    // was lighter at 70kg. The fallback must be 70, never 90.
    const result = derivePreviousExerciseLastLoad([
      history('bench', [['two-workouts-ago', 90], ['last-workout', 70]]),
    ], 'current');
    expect(result.bench).toBe(70);
    expect(result.bench).not.toBe(90);
  });

  it('leaves kg canonical and uses the existing kg/lb formatter for display', () => {
    const kg = derivePreviousExerciseLastLoad([
      history('bench', [['previous', 10]]),
    ], 'current').bench!;

    expect(formatWorkoutLoadFromKg(kg, 'metric')).toBe('10');
    expect(formatWorkoutLoadFromKg(kg, 'imperial')).toBe('22');
  });

  it('degrades to no reference when history is absent after a load error', () => {
    expect(() => derivePreviousExerciseLastLoad([], 'current')).not.toThrow();
    expect(derivePreviousExerciseLastLoad([], 'current')).toEqual({});
  });

  it('ignores non-positive/invalid points defensively', () => {
    expect(derivePreviousExerciseLastLoad([
      history('bench', [['valid', 50], ['zero', 0], ['nan', Number.NaN]]),
    ], 'current')).toEqual({ bench: 50 });
  });
});
