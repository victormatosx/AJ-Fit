import { describe, expect, it } from 'vitest';
import type { FinalWorkoutSession } from '../../workoutPrescription/types';
import {
  buildInitialExerciseExecutions,
  deriveFinishStatus,
  hasPendingSets,
  sweepPendingSetsToSkipped,
  workoutExecutionId,
} from '../types';

const REP_SESSION: FinalWorkoutSession = {
  name: 'A',
  type: 'strength',
  exercises: [
    { exerciseId: 'bench_press', sourceExerciseId: 'bench_press', sets: 3, reps: '8-12' },
    { exerciseId: 'plank', sourceExerciseId: 'plank', duration: '30s', cycles: 2 },
  ],
};

describe('workoutExecutionId', () => {
  it('is deterministic for the same (programId, sessionIndex, scheduledLocalDate)', () => {
    expect(workoutExecutionId('wpg_abc', 1, '2026-08-25')).toBe(workoutExecutionId('wpg_abc', 1, '2026-08-25'));
  });

  it('differs when any input differs', () => {
    const base = workoutExecutionId('wpg_abc', 1, '2026-08-25');
    expect(workoutExecutionId('wpg_xyz', 1, '2026-08-25')).not.toBe(base);
    expect(workoutExecutionId('wpg_abc', 2, '2026-08-25')).not.toBe(base);
    expect(workoutExecutionId('wpg_abc', 1, '2026-08-26')).not.toBe(base);
  });
});

describe('buildInitialExerciseExecutions', () => {
  it('materializes one PENDING set per prescribed set (sets ?? 1), preserving prescription snapshot fields', () => {
    const exercises = buildInitialExerciseExecutions(REP_SESSION);
    expect(exercises).toHaveLength(2);

    expect(exercises[0]).toMatchObject({
      exerciseIndex: 0,
      exerciseId: 'bench_press',
      prescribedSets: 3,
      prescribedReps: '8-12',
      prescribedDuration: null,
      prescribedCycles: null,
    });
    expect(exercises[0].sets).toHaveLength(3);
    expect(exercises[0].sets.every((s) => s.status === 'PENDING' && s.actualReps === null && s.weightKg === null)).toBe(true);

    // duration/cycles exercise: no `sets` field prescribed -> materializes exactly 1 set (mirrors WorkoutScreen).
    expect(exercises[1]).toMatchObject({
      exerciseId: 'plank',
      prescribedSets: null,
      prescribedDuration: '30s',
      prescribedCycles: 2,
    });
    expect(exercises[1].sets).toHaveLength(1);
  });

  it('applies a permanent-substitution override to exerciseId while prescribedExerciseId still reflects the plan', () => {
    const appliedAt = { seconds: 1, nanoseconds: 0 };
    const exercises = buildInitialExerciseExecutions(REP_SESSION, new Map([
      [0, { exerciseId: 'machine-flat-bench-press', appliedAt }],
    ]));
    expect(exercises[0]).toMatchObject({
      exerciseIndex: 0,
      exerciseId: 'machine-flat-bench-press',
      prescribedExerciseId: 'bench_press',
      substitution: { scope: 'PERMANENT', appliedAt },
    });
    // Untouched slot: no override applied, no `substitution` field at all.
    expect(exercises[1].exerciseId).toBe('plank');
    expect(exercises[1].prescribedExerciseId).toBe('plank');
    expect(exercises[1]).not.toHaveProperty('substitution');
  });

  it('is unaffected by omitting permanentOverrides — identical to the pre-existing 2-arg-less call', () => {
    expect(buildInitialExerciseExecutions(REP_SESSION)).toEqual(buildInitialExerciseExecutions(REP_SESSION, new Map()));
  });
});

describe('sweepPendingSetsToSkipped / deriveFinishStatus / hasPendingSets', () => {
  it('a fully completed session stays COMPLETED and has no pending sets', () => {
    const exercises = buildInitialExerciseExecutions(REP_SESSION).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, status: 'COMPLETED' as const, weightKg: 30 })),
    }));
    expect(hasPendingSets(exercises)).toBe(false);
    expect(deriveFinishStatus(sweepPendingSetsToSkipped(exercises))).toBe('COMPLETED');
  });

  it('an explicit SKIPPED set makes the finish status PARTIALLY_COMPLETED, without touching completed sets', () => {
    const exercises = buildInitialExerciseExecutions(REP_SESSION);
    exercises[0].sets[0] = { ...exercises[0].sets[0], status: 'COMPLETED', actualReps: 10, weightKg: 40 };
    exercises[0].sets[1] = { ...exercises[0].sets[1], status: 'SKIPPED' };
    const finished = sweepPendingSetsToSkipped(exercises);
    expect(finished[0].sets[0]).toMatchObject({ status: 'COMPLETED', actualReps: 10, weightKg: 40 });
    expect(finished[0].sets[1].status).toBe('SKIPPED');
    expect(deriveFinishStatus(finished)).toBe('PARTIALLY_COMPLETED');
  });

  it('finishing early sweeps every remaining PENDING set to SKIPPED and reports PARTIALLY_COMPLETED', () => {
    const exercises = buildInitialExerciseExecutions(REP_SESSION);
    exercises[0].sets[0] = { ...exercises[0].sets[0], status: 'COMPLETED', actualReps: 10, weightKg: 40 };
    expect(hasPendingSets(exercises)).toBe(true);
    const finished = sweepPendingSetsToSkipped(exercises);
    expect(finished.some((exercise) => exercise.sets.some((set) => set.status === 'PENDING'))).toBe(false);
    expect(finished[0].sets[1].status).toBe('SKIPPED');
    expect(finished[1].sets[0].status).toBe('SKIPPED');
    expect(deriveFinishStatus(finished)).toBe('PARTIALLY_COMPLETED');
  });

  it('skipping an entire exercise (all its sets) never falsely marks it COMPLETED', () => {
    const exercises = buildInitialExerciseExecutions(REP_SESSION);
    exercises[1].sets = exercises[1].sets.map((set) => ({ ...set, status: 'SKIPPED' as const }));
    const finished = sweepPendingSetsToSkipped(exercises);
    expect(deriveFinishStatus(finished)).toBe('PARTIALLY_COMPLETED');
  });
});
