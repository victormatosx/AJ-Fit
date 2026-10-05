export const WORKOUT_FINALIZATION_STAGES = [
  'WAITING',
  'CLIENT_READY',
  'SERVER_ACCEPTED',
  'PREFLIGHT_VALIDATED',
  'COMMITTED',
] as const;

export type WorkoutFinalizationProgressStage = typeof WORKOUT_FINALIZATION_STAGES[number];

export const WORKOUT_FINALIZATION_PROGRESS: Record<WorkoutFinalizationProgressStage, number> = {
  WAITING: 0,
  CLIENT_READY: 25,
  SERVER_ACCEPTED: 50,
  PREFLIGHT_VALIDATED: 75,
  COMMITTED: 100,
};

/** Progress is monotonic within one attempt, even if snapshots arrive out of order. */
export function furthestWorkoutFinalizationStage(
  current: WorkoutFinalizationProgressStage,
  candidate: WorkoutFinalizationProgressStage,
): WorkoutFinalizationProgressStage {
  return WORKOUT_FINALIZATION_PROGRESS[candidate] > WORKOUT_FINALIZATION_PROGRESS[current]
    ? candidate
    : current;
}

export function serverCheckpointFromSidecar(
  data: Record<string, unknown>,
): Extract<WorkoutFinalizationProgressStage, 'SERVER_ACCEPTED' | 'PREFLIGHT_VALIDATED' | 'COMMITTED'> | null {
  const checkpoints = data.checkpoints;
  if (typeof checkpoints === 'object' && checkpoints !== null) {
    if ('COMMITTED' in checkpoints) return 'COMMITTED';
    if ('PREFLIGHT_VALIDATED' in checkpoints) return 'PREFLIGHT_VALIDATED';
    if ('SERVER_ACCEPTED' in checkpoints) return 'SERVER_ACCEPTED';
    return null;
  }
  return null;
}
