import type { LoadPersonalRecord } from '../loadProgress/loadProgress';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { computeExerciseMaxLoadKg, performedExerciseIds } from './metrics';

export interface WorkoutHighlight {
  exerciseId: string;
  maxLoadKg: number | null;
  isPersonalRecord: boolean;
  /** All-time best before today — only meaningful when `isPersonalRecord`. */
  previousBestKg: number | null;
  /** Same exercise's best load in the previous equivalent session, if any. */
  previousSessionLoadKg: number | null;
  /** `maxLoadKg - previousSessionLoadKg`, only when both sides are known positive loads. */
  deltaVsPreviousSessionKg: number | null;
}

const DEFAULT_MAX_HIGHLIGHTS = 3;

/**
 * Deterministic selection, no invented score: (1) exercises with a PR set
 * today, in session order; then (2) remaining exercises with a positive
 * load improvement over the same exercise's previous equivalent session, by
 * largest improvement; then (3) remaining exercises by this session's best
 * load. An exercise never appears twice; bodyweight/duration-only exercises
 * (no valid load) are only ever picked by (1) if they somehow carry a PR —
 * never ranked by a fabricated score.
 */
export function selectWorkoutHighlights(input: {
  execution: PersistedWorkoutExecution;
  recordsLast90Days: readonly LoadPersonalRecord[];
  previousEquivalentExecution: PersistedWorkoutExecution | null;
  maxItems?: number;
}): WorkoutHighlight[] {
  const { execution, recordsLast90Days, previousEquivalentExecution, maxItems = DEFAULT_MAX_HIGHLIGHTS } = input;

  const prByExerciseId = new Map<string, LoadPersonalRecord>();
  recordsLast90Days.forEach((record) => {
    if (record.executionId === execution.executionId) prByExerciseId.set(record.exerciseId, record);
  });

  const exerciseIds = performedExerciseIds(execution);

  const build = (exerciseId: string): WorkoutHighlight => {
    const pr = prByExerciseId.get(exerciseId);
    const maxLoadKg = computeExerciseMaxLoadKg(execution, exerciseId);
    const previousSessionLoadKg = previousEquivalentExecution
      ? computeExerciseMaxLoadKg(previousEquivalentExecution, exerciseId)
      : null;
    const deltaVsPreviousSessionKg = maxLoadKg != null && previousSessionLoadKg != null
      ? maxLoadKg - previousSessionLoadKg
      : null;
    return {
      exerciseId,
      maxLoadKg,
      isPersonalRecord: !!pr,
      previousBestKg: pr?.previousBestKg ?? null,
      previousSessionLoadKg,
      deltaVsPreviousSessionKg,
    };
  };

  const all = exerciseIds.map(build);
  const picked: WorkoutHighlight[] = [];
  const pickedIds = new Set<string>();

  const take = (items: WorkoutHighlight[]) => {
    items.forEach((item) => {
      if (picked.length >= maxItems || pickedIds.has(item.exerciseId)) return;
      picked.push(item);
      pickedIds.add(item.exerciseId);
    });
  };

  take(all.filter((item) => item.isPersonalRecord));

  take(
    all
      .filter((item) => item.deltaVsPreviousSessionKg != null && item.deltaVsPreviousSessionKg > 0)
      .sort((a, b) => (b.deltaVsPreviousSessionKg as number) - (a.deltaVsPreviousSessionKg as number)),
  );

  take(
    all
      .filter((item) => item.maxLoadKg != null)
      .sort((a, b) => (b.maxLoadKg as number) - (a.maxLoadKg as number)),
  );

  return picked;
}
