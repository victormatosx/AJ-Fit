import type { PersistedWorkoutExecution } from '../services/workoutExecutions';

export interface WorkoutShareData {
  workoutName: string;
  exerciseCount: number;
  completedSetCount: number;
  durationSeconds: number;
}

export function countCompletedExecutionSets(
  execution: PersistedWorkoutExecution | null | undefined,
): number {
  return execution?.exercises.reduce(
    (total, exercise) => total + exercise.sets.filter((set) => set.status === 'COMPLETED').length,
    0,
  ) ?? 0;
}

export function buildWorkoutShareData(input: {
  workoutName: string;
  exerciseCount: number;
  execution: PersistedWorkoutExecution | null | undefined;
  durationSeconds: number;
}): WorkoutShareData {
  return {
    workoutName: input.workoutName,
    exerciseCount: input.exerciseCount,
    completedSetCount: countCompletedExecutionSets(input.execution),
    durationSeconds: Math.max(0, Math.floor(input.durationSeconds)),
  };
}

export function formatWorkoutShareDuration(durationSeconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours}h ${minutes}min`;
}
