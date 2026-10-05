import {
  REST_ACTIVITY_NEXT_ACTION,
  REST_ACTIVITY_PHASE,
  type WorkoutActiveActivityState,
} from '../types/restLiveActivity';

export type WorkoutActivityExerciseProgress = Readonly<{
  exerciseName: string;
  /** Count of leading COMPLETED/SKIPPED sets; zero for a fresh execution. */
  settledSets: number;
  totalSets: number;
}>;

export type WorkoutActivityStartInput = Readonly<{
  executionId: string;
  startedAt: number;
  /** Already resolved via `resolveSessionDisplayName`. */
  workoutName: string;
  exercises: readonly WorkoutActivityExerciseProgress[];
}>;

/**
 * Projects the durable workout execution into the pre-rest Live Activity
 * state. Zero completed sets is deliberately valid: ActivityKit publication
 * belongs to the workout start boundary, not to the first rest transition.
 */
export function projectWorkoutActiveActivityState(
  input: WorkoutActivityStartInput,
): WorkoutActiveActivityState | null {
  const current = input.exercises.find(
    (exercise) => exercise.totalSets > 0 && exercise.settledSets < exercise.totalSets,
  );
  if (!current) return null;

  return {
    sessionId: input.executionId,
    startedAt: input.startedAt,
    // Same instant as `startedAt` in this phase, but carried explicitly so the
    // surface reads one field for session elapsed time across every phase.
    workoutStartedAt: input.startedAt,
    workoutName: input.workoutName,
    exerciseName: current.exerciseName,
    setIndex: current.settledSets,
    totalSets: current.totalSets,
    phase: REST_ACTIVITY_PHASE.WORKOUT_ACTIVE,
    nextAction: REST_ACTIVITY_NEXT_ACTION.NEXT_SET,
    nextSetIndex: current.settledSets + 1,
  };
}
