import { deriveSessionMuscles, type SessionMuscleBreakdown } from '../lib/sessionMuscles';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';

export interface WorkoutShareData {
  workoutName: string;
  exerciseCount: number;
  completedSetCount: number;
  durationSeconds: number;
  /**
   * Primary/secondary muscles actually trained today, for the BodyMap
   * layout only — derived strictly from exercises that have at least one
   * COMPLETED set (never the full prescription, never invented). Empty
   * arrays are a legitimate, expected result (e.g. a catalog miss, or an
   * execution with nothing completed); the BodyMap poster must render a
   * graceful fallback rather than an empty silhouette in that case.
   */
  bodyMap: SessionMuscleBreakdown;
}

export function countCompletedExecutionSets(
  execution: PersistedWorkoutExecution | null | undefined,
): number {
  return execution?.exercises.reduce(
    (total, exercise) => total + exercise.sets.filter((set) => set.status === 'COMPLETED').length,
    0,
  ) ?? 0;
}

/**
 * Muscles actually trained today, for the BodyMap share poster. Reuses the
 * exact projection HomeScreen already uses for the pre-workout preview
 * (`deriveSessionMuscles` + the bundled exercise catalog), but scoped to
 * exercises the user actually performed (>=1 COMPLETED set) instead of the
 * full prescribed session — this is a completed-workout summary, not a
 * preview.
 */
export function buildWorkoutShareBodyMap(
  execution: PersistedWorkoutExecution | null | undefined,
): SessionMuscleBreakdown {
  const performedExerciseIds = (execution?.exercises ?? [])
    .filter((exercise) => exercise.sets.some((set) => set.status === 'COMPLETED'))
    .map((exercise) => exercise.exerciseId);
  return deriveSessionMuscles(performedExerciseIds);
}

export function buildWorkoutShareData(input: {
  workoutName: string;
  exerciseCount: number;
  execution: PersistedWorkoutExecution | null | undefined;
  durationSeconds: number;
}): WorkoutShareData {
  const performedExerciseCount = input.execution?.exercises.filter((exercise) =>
    exercise.sets.some((set) => set.status === 'COMPLETED')).length;
  return {
    workoutName: input.workoutName,
    // A completed-workout card reports what was actually performed. Fall
    // back to the caller's plan count only when no execution snapshot exists.
    exerciseCount: performedExerciseCount ?? input.exerciseCount,
    completedSetCount: countCompletedExecutionSets(input.execution),
    durationSeconds: Math.max(0, Math.floor(input.durationSeconds)),
    bodyMap: buildWorkoutShareBodyMap(input.execution),
  };
}

export function formatWorkoutShareDuration(durationSeconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours}h ${minutes}min`;
}
