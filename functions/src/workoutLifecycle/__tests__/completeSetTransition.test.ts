import { describe, expect, it } from 'vitest';
import {
  decideSetCompletion,
  isValidActualReps,
  isValidWeightKg,
  type MinimalExerciseExecution,
} from '../completeSetTransition';

function exercises(sets: MinimalExerciseExecution['sets']): MinimalExerciseExecution[] {
  return [{ sets }];
}

describe('decideSetCompletion (functions/ mirror of src/workoutExecution/completeSetTransition.ts)', () => {
  it('completes a PENDING set with the submitted values', () => {
    const result = decideSetCompletion({
      exercises: exercises([{ status: 'PENDING', weightKg: null, actualReps: null }]),
      exerciseIndex: 0,
      setIndex: 0,
      weightKg: 42.5,
      actualReps: 11,
    });
    expect(result).toEqual({ outcome: 'completed_now', weightKg: 42.5, actualReps: 11 });
  });

  it('never overwrites an already-COMPLETED set — returns the persisted authoritative values instead', () => {
    const result = decideSetCompletion({
      exercises: exercises([{ status: 'COMPLETED', weightKg: 40, actualReps: 10 }]),
      exerciseIndex: 0,
      setIndex: 0,
      weightKg: 999,
      actualReps: 999,
    });
    expect(result).toEqual({ outcome: 'already_completed', weightKg: 40, actualReps: 10 });
  });

  it('rejects a SKIPPED set', () => {
    const result = decideSetCompletion({
      exercises: exercises([{ status: 'SKIPPED', weightKg: null, actualReps: null }]),
      exerciseIndex: 0,
      setIndex: 0,
      weightKg: 40,
      actualReps: 10,
    });
    expect(result).toEqual({ outcome: 'rejected', reason: 'SET_NOT_PENDING' });
  });

  it('rejects an out-of-range exerciseIndex/setIndex', () => {
    const state = exercises([{ status: 'PENDING', weightKg: null, actualReps: null }]);
    expect(decideSetCompletion({ exercises: state, exerciseIndex: 5, setIndex: 0, weightKg: 40, actualReps: 10 }))
      .toEqual({ outcome: 'rejected', reason: 'INVALID_EXERCISE_INDEX' });
    expect(decideSetCompletion({ exercises: state, exerciseIndex: 0, setIndex: 5, weightKg: 40, actualReps: 10 }))
      .toEqual({ outcome: 'rejected', reason: 'INVALID_SET_INDEX' });
  });

  it('is idempotent — the same already-completed decision every time', () => {
    const completedState = exercises([{ status: 'COMPLETED', weightKg: 42.5, actualReps: 11 }]);
    const first = decideSetCompletion({ exercises: completedState, exerciseIndex: 0, setIndex: 0, weightKg: 1, actualReps: 1 });
    const second = decideSetCompletion({ exercises: completedState, exerciseIndex: 0, setIndex: 0, weightKg: 2, actualReps: 2 });
    expect(first).toEqual(second);
  });
});

describe('isValidActualReps / isValidWeightKg (functions/ mirror)', () => {
  it('actualReps: positive integers and null only', () => {
    expect(isValidActualReps(11)).toBe(true);
    expect(isValidActualReps(null)).toBe(true);
    expect(isValidActualReps(0)).toBe(false);
    expect(isValidActualReps(-1)).toBe(false);
    expect(isValidActualReps(1.5)).toBe(false);
  });

  it('weightKg: non-negative finite numbers and null only', () => {
    expect(isValidWeightKg(0)).toBe(true);
    expect(isValidWeightKg(42.5)).toBe(true);
    expect(isValidWeightKg(null)).toBe(true);
    expect(isValidWeightKg(-0.01)).toBe(false);
    expect(isValidWeightKg(Number.NaN)).toBe(false);
  });
});
