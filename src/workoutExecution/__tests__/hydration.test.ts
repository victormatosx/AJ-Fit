import { describe, expect, it } from 'vitest';
import { deriveWorkoutHydration } from '../hydration';
import { buildInitialExerciseExecutions, type ExerciseExecution } from '../types';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';

const SESSION: FinalWorkoutSession = {
  name: 'Upper',
  type: 'strength',
  exercises: [
    { exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' },
    { exerciseId: 'lat_pulldown', sourceExerciseId: 'lat_pulldown', sets: 2, reps: '8-12' },
    { exerciseId: 'plank', sourceExerciseId: 'plank', duration: '30s', cycles: 2 },
  ],
};

const EXERCISE_IDS = ['bench_press', 'lat_pulldown', 'plank'];

function withSet(exercises: ExerciseExecution[], exerciseIndex: number, setIndex: number, patch: Partial<ExerciseExecution['sets'][number]>): ExerciseExecution[] {
  return exercises.map((exercise, i) => {
    if (i !== exerciseIndex) return exercise;
    return {
      ...exercise,
      sets: exercise.sets.map((set, j) => (j === setIndex ? { ...set, ...patch } : set)),
    };
  });
}

describe('deriveWorkoutHydration', () => {
  it('derives to the same empty defaults WorkoutScreen already used for a freshly-started (all-PENDING) execution', () => {
    const exercises = buildInitialExerciseExecutions(SESSION);
    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration).toEqual({
      order: [0, 1, 2],
      progress: { 0: 0, 1: 0, 2: 0 },
      logged: {},
      loggedReps: {},
      allDone: false,
      cardioCompleted: false,
    });
  });

  it('recovery básico: completed sets resume at the first still-pending set, not set 1', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    exercises = withSet(exercises, 0, 0, { status: 'COMPLETED', weightKg: 60 });
    exercises = withSet(exercises, 0, 1, { status: 'COMPLETED', weightKg: 60 });
    // exercise 0 set 2 (index 2) is still PENDING — that's the resume point.

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.progress[0]).toBe(2); // next set to perform = index 2 ("set 3")
    expect(hydration.order[0]).toBe(0); // exercise 0 is still current — not skipped forward
    expect(hydration.allDone).toBe(false);
  });

  it('cargas: preserves exactly the weights already logged, keyed the same way WorkoutScreen\'s `logged`/`lastWeight()` already read', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    exercises = withSet(exercises, 0, 0, { status: 'COMPLETED', weightKg: 62.5 });
    exercises = withSet(exercises, 0, 1, { status: 'COMPLETED', weightKg: 0 }); // 0 kg (bodyweight) is a valid logged value, never treated as "not logged"

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.logged).toEqual({
      'bench_press-0': 62.5,
      'bench_press-1': 0,
    });
  });

  it('reps: preserves actualReps already recorded per set, keyed the same way as `logged` — a duration exercise (plank) never gets an entry since it never has actualReps set', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    exercises = withSet(exercises, 0, 0, { status: 'COMPLETED', weightKg: 60, actualReps: 8 });
    exercises = withSet(exercises, 0, 1, { status: 'COMPLETED', weightKg: 60 }); // no reps logged for this one
    exercises = withSet(exercises, 1, 0, { status: 'COMPLETED', weightKg: 20, actualReps: 12 });

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.loggedReps).toEqual({
      'bench_press-0': 8,
      'lat_pulldown-0': 12,
    });
    expect(hydration.loggedReps['bench_press-1']).toBeUndefined();
    expect(hydration.loggedReps['plank-0']).toBeUndefined();
  });

  it('skip: a SKIPPED set advances the resume point exactly like a COMPLETED one, and never leaves a logged weight behind', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    exercises = withSet(exercises, 1, 0, { status: 'SKIPPED' });

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.progress[1]).toBe(1);
    expect(hydration.logged['lat_pulldown-0']).toBeUndefined();
  });

  it('an exercise fully skipped/completed is dropped from `order`, mirroring `exDone`/`order.slice(1)`', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    exercises = withSet(exercises, 1, 0, { status: 'SKIPPED' });
    exercises = withSet(exercises, 1, 1, { status: 'COMPLETED', weightKg: 40 });

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.order).toEqual([0, 2]); // exercise 1 (fully done) is gone from the queue
    expect(hydration.progress[1]).toBe(2);
  });

  it('allDone is true only once every exercise has no PENDING set left, so the resumed screen can open on completion/finisher directly', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    for (let exIdx = 0; exIdx < exercises.length; exIdx += 1) {
      for (let setIdx = 0; setIdx < exercises[exIdx].sets.length; setIdx += 1) {
        exercises = withSet(exercises, exIdx, setIdx, { status: 'COMPLETED', weightKg: 20 });
      }
    }
    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.order).toEqual([]);
    expect(hydration.allDone).toBe(true);
  });

  it('a gap (a later set done while an earlier one is still PENDING) still resumes at the first PENDING set — never skips ahead', () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    // Defensive case: only reachable via the service-level skipSetExecution/recordSetExecution
    // functions used out of natural sequence — never via today's sequential UI, but the
    // hydration derivation must still fail closed to a safe, deterministic resume point.
    exercises = withSet(exercises, 0, 1, { status: 'COMPLETED', weightKg: 60 });

    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.progress[0]).toBe(0); // set 0 is still PENDING — that's the resume point
    expect(hydration.logged['bench_press-1']).toBe(60); // the out-of-order logged weight is still preserved for display
  });
});

// Cardio Finisher Completion Recovery hardening (2026-09).
describe('deriveWorkoutHydration — cardioCompleted', () => {
  const allDoneExercises = () => {
    let exercises = buildInitialExerciseExecutions(SESSION);
    for (let exIdx = 0; exIdx < exercises.length; exIdx += 1) {
      for (let setIdx = 0; setIdx < exercises[exIdx].sets.length; setIdx += 1) {
        exercises = withSet(exercises, exIdx, setIdx, { status: 'COMPLETED', weightKg: 20 });
      }
    }
    return exercises;
  };

  it('is false when `cardio` is absent (legacy execution / no cardio finisher on this plan)', () => {
    const exercises = buildInitialExerciseExecutions(SESSION);
    const hydration = deriveWorkoutHydration({ exercises }, EXERCISE_IDS);
    expect(hydration.cardioCompleted).toBe(false);
  });

  it('is false when `cardio` is explicitly null (not started/not finished yet)', () => {
    const exercises = buildInitialExerciseExecutions(SESSION);
    const hydration = deriveWorkoutHydration({ exercises, cardio: null }, EXERCISE_IDS);
    expect(hydration.cardioCompleted).toBe(false);
  });

  it('is true only once the persisted record is COMPLETED — independent of local timer state, which this function never sees', () => {
    const exercises = allDoneExercises();
    const hydration = deriveWorkoutHydration(
      { exercises, cardio: { status: 'COMPLETED', actualDurationSeconds: 900, completedAt: null } },
      EXERCISE_IDS,
    );
    expect(hydration.allDone).toBe(true);
    expect(hydration.cardioCompleted).toBe(true);
  });
});
