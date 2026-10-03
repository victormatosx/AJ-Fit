import type { ExerciseExecution } from '../workoutExecution/types';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';

/**
 * Session metrics derived strictly from persisted, COMPLETED sets — never a
 * second source of truth for load (see `loadProgress/loadProgress.ts`'s
 * `positiveCompletedLoad`, which this mirrors) and never fabricated for a
 * set that was skipped or never touched.
 */
function completedRepsLoads(exercises: readonly ExerciseExecution[]): { weightKg: number; actualReps: number }[] {
  const points: { weightKg: number; actualReps: number }[] = [];
  exercises.forEach((exercise) => {
    exercise.sets.forEach((set) => {
      if (set.status !== 'COMPLETED') return;
      if (typeof set.weightKg !== 'number' || !Number.isFinite(set.weightKg)) return;
      if (typeof set.actualReps !== 'number' || !Number.isFinite(set.actualReps)) return;
      points.push({ weightKg: set.weightKg, actualReps: set.actualReps });
    });
  });
  return points;
}

/** Σ (weightKg × actualReps) over COMPLETED, reps-based sets only. Bodyweight sets (weightKg = 0) legitimately contribute 0. */
export function computeSessionVolumeKg(execution: PersistedWorkoutExecution | null | undefined): number {
  return completedRepsLoads(execution?.exercises ?? [])
    .reduce((total, point) => total + point.weightKg * point.actualReps, 0);
}

/** Total repetitions actually performed — COMPLETED sets only, reps-based exercises only (duration-based sets have no `actualReps`). */
export function computeTotalCompletedReps(execution: PersistedWorkoutExecution | null | undefined): number {
  return completedRepsLoads(execution?.exercises ?? [])
    .reduce((total, point) => total + point.actualReps, 0);
}

/** Heaviest single COMPLETED set across the whole session — 0 when nothing valid was logged (e.g. bodyweight-only or duration-only session), never a guess. */
export function computeSessionMaxLoadKg(execution: PersistedWorkoutExecution | null | undefined): number {
  let max = 0;
  (execution?.exercises ?? []).forEach((exercise) => {
    exercise.sets.forEach((set) => {
      if (set.status !== 'COMPLETED') return;
      if (typeof set.weightKg !== 'number' || !Number.isFinite(set.weightKg) || set.weightKg <= 0) return;
      if (set.weightKg > max) max = set.weightKg;
    });
  });
  return max;
}

/** Heaviest COMPLETED set for one specific exercise in this execution — used by Highlights/Recordes to show "melhor carga" per exercise. `null` when nothing valid was logged for it. */
export function computeExerciseMaxLoadKg(
  execution: PersistedWorkoutExecution | null | undefined,
  exerciseId: string,
): number | null {
  let max: number | null = null;
  (execution?.exercises ?? []).forEach((exercise) => {
    if (exercise.exerciseId !== exerciseId) return;
    exercise.sets.forEach((set) => {
      if (set.status !== 'COMPLETED') return;
      if (typeof set.weightKg !== 'number' || !Number.isFinite(set.weightKg) || set.weightKg <= 0) return;
      if (max == null || set.weightKg > max) max = set.weightKg;
    });
  });
  return max;
}

/** Distinct exercise ids with at least one COMPLETED set, in `exerciseIndex` order — the deterministic iteration base for Highlights/Recordes. */
export function performedExerciseIds(execution: PersistedWorkoutExecution | null | undefined): string[] {
  const seen = new Set<string>();
  return (execution?.exercises ?? [])
    .filter((exercise) => exercise.sets.some((set) => set.status === 'COMPLETED'))
    .sort((a, b) => a.exerciseIndex - b.exerciseIndex)
    .map((exercise) => exercise.exerciseId)
    .filter((exerciseId) => {
      if (seen.has(exerciseId)) return false;
      seen.add(exerciseId);
      return true;
    });
}
